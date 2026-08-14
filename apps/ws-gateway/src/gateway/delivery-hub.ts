import type { FastifyBaseLogger } from 'fastify'
import type { Redis } from 'ioredis'
import type { ConnectionRegistry } from './connection-registry.js'
import { isStreamIdNewer } from './stream-id.js'

export type DeliveryHub = ReturnType<typeof createDeliveryHub>

export type DeliveryHubDeps = {
  registry: ConnectionRegistry
  /** Dedicated SUBSCRIBE-mode connection — see gateway.plugin.ts's comment on why it must be separate from the general-purpose one. */
  subscriber: Pick<Redis, 'on'>
  logger: FastifyBaseLogger
}

/**
 * The protocol-agnostic half of realtime fan-out — everything the
 * WebSocket route (gateway.plugin.ts) and the SSE route (sse.plugin.ts,
 * ROADMAP.md 2.2's fallback bullet) share: one Redis pub/sub dispatcher per
 * *process*, keyed by connectionId rather than by socket type, plus the
 * dedup guard that keeps a reconnect's replay-then-live handoff from ever
 * delivering the same event twice (SPECS.md §8.3's "sin duplicados ni
 * huecos"). Built once in gateway.plugin.ts and handed to both route
 * registrars specifically so a channel with both a WS listener and an SSE
 * listener open in the same process still issues exactly one real Redis
 * `SUBSCRIBE` for it — two independent hubs would each subscribe on their
 * own, and connection-registry.ts's own isNewChannel/isChannelEmpty
 * bookkeeping only holds that invariant if every connection in the process,
 * of either protocol, shares the one registry.
 *
 * `sink`, not a raw socket: a WebSocket send and an SSE `reply.raw.write`
 * have different call shapes and different backpressure signals
 * (`bufferedAmount` vs. `writableLength`) — each route adapts its own
 * transport into a plain `(raw, eventId) => void` before registering here,
 * so this module doesn't need to know either protocol exists. `eventId` is
 * passed alongside `raw` (rather than left for the sink to re-parse back
 * out of it) purely so sse.plugin.ts can write SSE's `id:` field without a
 * second JSON.parse of something this module already parsed once for the
 * dedup check below — the WS sink ignores it, framing needs no `id:` line.
 */
export function createDeliveryHub(deps: DeliveryHubDeps) {
  const { registry, subscriber, logger } = deps
  const sinksByConnectionId = new Map<string, (raw: string, eventId: string) => void>()
  // Per connection, the newest eventId already delivered on each channel —
  // the one thing a live PUBLISH and a replayed XRANGE/SSE-replay entry for
  // the same event have in common, so this single guard, applied on every
  // delivery path, is what keeps a reconnect from ever seeing a duplicate
  // or a gap.
  const lastDeliveredEventIdByConnection = new Map<string, Map<string, string>>()

  function deliverEvent(connectionId: string, channel: string, eventId: string, raw: string): void {
    const sink = sinksByConnectionId.get(connectionId)
    if (!sink) return

    const perChannel = lastDeliveredEventIdByConnection.get(connectionId)
    const lastId = perChannel?.get(channel)
    if (lastId !== undefined && !isStreamIdNewer(eventId, lastId)) return // already delivered

    if (perChannel) {
      perChannel.set(channel, eventId)
    } else {
      lastDeliveredEventIdByConnection.set(connectionId, new Map([[channel, eventId]]))
    }
    sink(raw, eventId)
  }

  // One shared Redis subscriber connection dispatches every incoming
  // pub/sub message to whichever of *this process's* connections currently
  // care about that channel, WS or SSE alike — SPECS.md §8.3's "cada
  // instancia mantiene un mapa channel → Set<connection>." The publisher
  // (apps/workers' fan-out) is trusted to have already built a
  // wire-format-correct envelope, the same trust boundary this codebase
  // already gives BullMQ job payloads — but `eventId` specifically has to
  // be read out of it here, not just relayed blind, for the dedup guard
  // above to work at all.
  subscriber.on('message', (channel: string, raw: string) => {
    let eventId: unknown
    try {
      eventId = (JSON.parse(raw) as { eventId?: unknown }).eventId
    } catch {
      logger.warn({ channel }, 'discarding a non-JSON realtime pub/sub message')
      return
    }
    if (typeof eventId !== 'string') {
      logger.warn({ channel }, 'discarding a realtime pub/sub message with no eventId')
      return
    }
    for (const connectionId of registry.connectionsFor(channel)) {
      deliverEvent(connectionId, channel, eventId, raw)
    }
  })

  return {
    /** Registers a connection's delivery callback — once per new WS/SSE connection, before it subscribes to anything. */
    register(connectionId: string, sink: (raw: string, eventId: string) => void): void {
      sinksByConnectionId.set(connectionId, sink)
    },
    /** Tears down a connection's delivery callback and dedup state — once, on disconnect. */
    unregister(connectionId: string): void {
      sinksByConnectionId.delete(connectionId)
      lastDeliveredEventIdByConnection.delete(connectionId)
    },
    deliverEvent,
  }
}
