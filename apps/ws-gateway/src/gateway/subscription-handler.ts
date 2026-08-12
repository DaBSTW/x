import type { Redis } from 'ioredis'
import { authorizeChannel } from './channel-authorization.js'
import type { ConnectionRegistry } from './connection-registry.js'
import type { RealtimeRepository } from './realtime.repository.js'
import { type ReplayedEvent, replayMissedEvents } from './stream-replay.js'

export type SubscriptionHandlerDeps = {
  registry: ConnectionRegistry
  repository: RealtimeRepository
  /** Dedicated SUBSCRIBE-mode connection — see gateway.plugin.ts's comment on why it must be separate from the general-purpose one. */
  subscriber: Pick<Redis, 'subscribe' | 'unsubscribe'>
  /** General-purpose connection — used here only for the `XRANGE` replay reads below. */
  redis: Pick<Redis, 'xrange'>
}

export type SubscribeOutcome = {
  applied: string[]
  denied: string[]
  /** Missed events to replay per successfully-applied channel that carried a `since` — SPECS.md §8.3. Empty for a channel with no `since` (the normal first-time-subscribing case) or nothing missed. */
  replay: Array<{ channel: string; events: ReplayedEvent[] }>
}

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
  const { registry, repository, subscriber, redis } = deps

  return {
    async subscribe(
      connectionId: string,
      userId: bigint,
      channels: string[],
      since?: Record<string, string>,
    ): Promise<SubscribeOutcome> {
      // Independent per-channel work — CODESTYLE.md §10: Promise.all, never a sequential await-in-loop.
      const outcomes = await Promise.all(
        channels.map(async (channel) => {
          const allowed = await authorizeChannel(channel, userId, {
            conversationMembership: { isMember: repository.isConversationMember },
          })
          if (!allowed) return { channel, allowed: false as const, events: [] as ReplayedEvent[] }

          const { isNewChannel } = registry.subscribe(connectionId, channel)
          // Redis SUBSCRIBE first, replay second: from the instant we're
          // subscribed, live events flow independently of this replay ever
          // finishing — the two can only overlap, never leave a gap
          // between "what replay covered" and "what live delivery starts
          // covering" (gateway.plugin.ts's dedup guard on eventId is what
          // then keeps that overlap from double-delivering).
          if (isNewChannel) await subscriber.subscribe(channel)

          const sinceId = since?.[channel]
          const events = sinceId ? await replayMissedEvents(redis, channel, sinceId) : []
          return { channel, allowed: true as const, events }
        }),
      )
      return {
        applied: outcomes.filter((o) => o.allowed).map((o) => o.channel),
        denied: outcomes.filter((o) => !o.allowed).map((o) => o.channel),
        replay: outcomes
          .filter((o) => o.allowed && o.events.length > 0)
          .map((o) => ({ channel: o.channel, events: o.events })),
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
