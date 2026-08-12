import type { Redis } from 'ioredis'
import { authorizeChannel } from './channel-authorization.js'
import type { ConnectionRegistry } from './connection-registry.js'
import type { RealtimeRepository } from './realtime.repository.js'

export type SubscriptionHandlerDeps = {
  registry: ConnectionRegistry
  repository: RealtimeRepository
  /** Dedicated SUBSCRIBE-mode connection — see gateway.plugin.ts's comment on why it must be separate from the general-purpose one. */
  subscriber: Pick<Redis, 'subscribe' | 'unsubscribe'>
}

export type SubscribeOutcome = { applied: string[]; denied: string[] }

export type SubscriptionHandler = ReturnType<typeof createSubscriptionHandler>

/**
 * Authorizes and applies a connection's channel (un)subscriptions —
 * SPECS.md §8.1's `{op: "subscribe"/"unsubscribe", channels: [...]}` —
 * extracted out of gateway.plugin.ts so the actual per-message logic is
 * unit-testable with fakes instead of only reachable through a real
 * WebSocket handshake (same split as apps/workers' fanout.worker.ts, thin
 * wiring, vs. fanout.processor.ts, the injectable logic).
 */
export function createSubscriptionHandler(deps: SubscriptionHandlerDeps) {
  const { registry, repository, subscriber } = deps

  return {
    async subscribe(
      connectionId: string,
      userId: bigint,
      channels: string[],
    ): Promise<SubscribeOutcome> {
      // Independent per-channel work — CODESTYLE.md §10: Promise.all, never a sequential await-in-loop.
      const outcomes = await Promise.all(
        channels.map(async (channel) => {
          const allowed = await authorizeChannel(channel, userId, {
            conversationMembership: { isMember: repository.isConversationMember },
          })
          if (!allowed) return { channel, allowed: false as const }
          const { isNewChannel } = registry.subscribe(connectionId, channel)
          if (isNewChannel) await subscriber.subscribe(channel)
          return { channel, allowed: true as const }
        }),
      )
      return {
        applied: outcomes.filter((o) => o.allowed).map((o) => o.channel),
        denied: outcomes.filter((o) => !o.allowed).map((o) => o.channel),
      }
    },

    async unsubscribe(connectionId: string, channels: string[]): Promise<string[]> {
      return Promise.all(
        channels.map(async (channel) => {
          const { isChannelEmpty } = registry.unsubscribe(connectionId, channel)
          if (isChannelEmpty) await subscriber.unsubscribe(channel)
          return channel
        }),
      )
    },

    /** Every channel a connection was on, torn down at once — called once, on disconnect. */
    async disconnect(connectionId: string): Promise<void> {
      const results = registry.unsubscribeAll(connectionId)
      await Promise.all(
        results.filter((r) => r.isChannelEmpty).map((r) => subscriber.unsubscribe(r.channel)),
      )
    },
  }
}
