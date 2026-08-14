import {
  REALTIME_STREAM_FIELD_DATA,
  REALTIME_STREAM_FIELD_EVENT,
  realtimeStreamKey,
} from '@x/utils'
import type { Redis } from 'ioredis'

export type PolledEvent = {
  eventId: string
  event: string
  data: unknown
}

// Same margin as apps/ws-gateway's own stream-replay.ts, same reasoning —
// a cap exists only so a client that vanishes for hours doesn't force one
// giant XRANGE on reconnect. Duplicated, not imported: apps/* never import
// each other (CODESTYLE.md §7).
const REPLAY_LIMIT = 1000

function parsePolledEntry(id: string, fields: string[]): PolledEvent {
  const record: Record<string, string> = {}
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i]
    const value = fields[i + 1]
    if (key !== undefined && value !== undefined) record[key] = value
  }
  return {
    eventId: id,
    event: record[REALTIME_STREAM_FIELD_EVENT] ?? '',
    data: JSON.parse(record[REALTIME_STREAM_FIELD_DATA] ?? 'null'),
  }
}

/**
 * Everything published on `channel` strictly after `sinceId` — the read
 * side of GET /realtime/poll (ROADMAP.md 2.2's polling fallback), reading
 * the exact same Redis Stream apps/workers' fanout.processor.ts writes and
 * apps/ws-gateway's own replay reads. Inherits that stream's 5-minute
 * MINID retention (`@x/utils`' REALTIME_STREAM_RETENTION_MS) — a client
 * that polls less often than that loses events same as a WS/SSE connection
 * that stays disconnected that long would.
 */
export async function replayMissedEvents(
  redis: Pick<Redis, 'xrange'>,
  channel: string,
  sinceId: string,
): Promise<PolledEvent[]> {
  const entries = await redis.xrange(
    realtimeStreamKey(channel),
    `(${sinceId}`, // exclusive lower bound — `since` is the last event the client already saw
    '+',
    'COUNT',
    REPLAY_LIMIT,
  )
  return entries.map(([id, fields]) => parsePolledEntry(id, fields))
}

/**
 * The most recent entry id on `channel`'s stream, or null if it's never had
 * anything published — what a client's *first* poll (no `since` yet) gets
 * back as its baseline cursor. Deliberately doesn't return that entry's
 * full history: same "just subscribe live, nothing to replay" default the
 * WS/SSE paths already use for a first-time subscribe (an omitted `since`
 * there means "live only" too), not a full backfill of everything the
 * channel ever saw.
 */
export async function latestStreamEntryId(
  redis: Pick<Redis, 'xrevrange'>,
  channel: string,
): Promise<string | null> {
  const entries = await redis.xrevrange(realtimeStreamKey(channel), '+', '-', 'COUNT', 1)
  return entries[0]?.[0] ?? null
}
