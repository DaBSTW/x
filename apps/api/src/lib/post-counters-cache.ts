import {
  COUNTER_FIELDS,
  type CounterField,
  type CounterValues,
  DIRTY_POST_COUNTERS_KEY,
  parseCounterHash,
  postCountersKey,
  zeroCounterValues,
} from '@x/utils'
import type { Redis } from 'ioredis'

export type CachedCounters = CounterValues
export { zeroCounterValues as zeroCounters }

/** Reads the live Redis counters hash; `null` on a cold miss (never written, or evicted). */
export async function readCounters(redis: Redis, postId: bigint): Promise<CachedCounters | null> {
  const raw = await redis.hgetall(postCountersKey(postId))
  return Object.keys(raw).length === 0 ? null : parseCounterHash(raw)
}

/** Batch read for list/timeline endpoints — one pipeline instead of N round trips. */
export async function readCountersMany(
  redis: Redis,
  postIds: bigint[],
): Promise<Map<bigint, CachedCounters>> {
  if (postIds.length === 0) return new Map()

  const pipeline = redis.pipeline()
  for (const id of postIds) pipeline.hgetall(postCountersKey(id))
  const results = (await pipeline.exec()) ?? []

  const map = new Map<bigint, CachedCounters>()
  results.forEach(([error, raw], index) => {
    if (error) return
    const hash = raw as Record<string, string>
    if (Object.keys(hash).length === 0) return
    const id = postIds[index]
    if (id !== undefined) map.set(id, parseCounterHash(hash))
  })
  return map
}

/**
 * Increments one field and marks the post dirty for the next flush
 * (SPECS.md §4.4). `fetchBaseline` is only called — and only its result
 * trusted — on a genuine cold miss; `HSETNX` per field means a second
 * concurrent seed just no-ops instead of clobbering the first.
 */
export async function bumpCounter(
  redis: Redis,
  postId: bigint,
  field: CounterField,
  delta: number,
  fetchBaseline: () => Promise<CachedCounters>,
): Promise<void> {
  const key = postCountersKey(postId)
  const exists = await redis.exists(key)
  if (!exists) {
    const baseline = await fetchBaseline()
    const seed = redis.pipeline()
    for (const counterField of COUNTER_FIELDS) {
      seed.hsetnx(key, counterField, baseline[counterField])
    }
    await seed.exec()
  }

  await redis
    .multi()
    .hincrby(key, field, delta)
    .sadd(DIRTY_POST_COUNTERS_KEY, postId.toString())
    .exec()
}
