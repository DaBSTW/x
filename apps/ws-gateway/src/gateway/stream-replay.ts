import {
  REALTIME_STREAM_FIELD_DATA,
  REALTIME_STREAM_FIELD_EVENT,
  realtimeStreamKey,
} from '@x/utils'
import type { Redis } from 'ioredis'

export type ReplayedEvent = {
  id: string
  /** Fully-formed JSON matching `RealtimeServerEvent` — ready to send as-is, the same shape a live PUBLISH carries. */
  raw: string
}

// Generous margin over SPECS.md §17.2's own acceptance test ("recuperación
// de 500 eventos perdidos") — a cap exists at all only so a client that
// vanishes for hours doesn't force one giant XRANGE on reconnect; the
// 5-minute MINID retention (fanout.processor.ts) already bounds this in
// practice long before 1000 would ever matter.
const REPLAY_LIMIT = 1000

/**
 * Everything published on `channel` strictly after `sinceId` — SPECS.md
 * §8.3's lost-event recovery ("al reconectar, el cliente envía
 * last_event_id; el servidor reenvía lo perdido desde un buffer Redis
 * Stream"). Reconstructs the same envelope shape a live PUBLISH sends
 * (gateway.plugin.ts's relay path) from the durable copy
 * fanout.processor.ts's XADD wrote alongside every PUBLISH.
 */
export async function replayMissedEvents(
  redis: Pick<Redis, 'xrange'>,
  channel: string,
  sinceId: string,
): Promise<ReplayedEvent[]> {
  const entries = await redis.xrange(
    realtimeStreamKey(channel),
    `(${sinceId}`, // exclusive lower bound — `since` is the last event the client already saw
    '+',
    'COUNT',
    REPLAY_LIMIT,
  )

  return entries.map(([id, fields]) => {
    const record: Record<string, string> = {}
    for (let i = 0; i < fields.length; i += 2) {
      const key = fields[i]
      const value = fields[i + 1]
      if (key !== undefined && value !== undefined) record[key] = value
    }

    const raw = JSON.stringify({
      op: 'event',
      channel,
      event: record[REALTIME_STREAM_FIELD_EVENT] ?? '',
      data: JSON.parse(record[REALTIME_STREAM_FIELD_DATA] ?? 'null'),
      eventId: id,
    })
    return { id, raw }
  })
}
