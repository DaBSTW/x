// Shared between apps/api (bumps counters on like/repost/bookmark) and
// apps/workers (flushes them to Postgres) — SPECS.md §4.4.

/** Redis is authoritative for reads; this hash holds the live count per post. */
export function postCountersKey(postId: string | bigint): string {
  return `post:${postId}:counters`
}

/** Fields of the `post:{id}:counters` hash — matches post_counters' *_count columns, minus `views` (synced from ClickHouse in phase 3, not touched by likes/reposts/bookmarks). */
export const COUNTER_FIELDS = ['likes', 'reposts', 'replies', 'quotes', 'bookmarks'] as const
export type CounterField = (typeof COUNTER_FIELDS)[number]

/** Post ids with a Redis count the 5s flush worker hasn't persisted to Postgres yet. */
export const DIRTY_POST_COUNTERS_KEY = 'dirty:post_counters'

/** SPECS.md §4.4: "un worker consume el evento y aplica el incremento en lote cada 5 s". */
export const COUNTER_FLUSH_INTERVAL_MS = 5_000

export type CounterValues = Record<CounterField, number>

export function zeroCounterValues(): CounterValues {
  return { likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 }
}

/** Parses a `post:{id}:counters` HGETALL result — shared so apps/api (writer) and apps/workers (flush reader) agree on the shape. */
export function parseCounterHash(raw: Record<string, string>): CounterValues {
  const result = zeroCounterValues()
  for (const field of COUNTER_FIELDS) {
    const value = raw[field]
    if (value !== undefined) result[field] = Number(value)
  }
  return result
}
