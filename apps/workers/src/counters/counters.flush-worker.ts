import { DIRTY_POST_COUNTERS_KEY, parseCounterHash, postCountersKey } from '@x/utils'
import type { Redis } from 'ioredis'
import type { CountersRepository } from './counters.repository.js'

// Bounds worst-case work per tick; SPOP just claims fewer than this many
// dirty posts if there's less backlog, so a normal 5s tick pops them all.
const FLUSH_BATCH_SIZE = 10_000

export type CountersFlushWorker = {
  /** Runs one flush pass immediately — exposed for tests and the concurrency benchmark, not just the interval. */
  flushOnce: () => Promise<number>
  start: () => void
  stop: () => void
}

export function createCountersFlushWorker(
  repository: CountersRepository,
  redis: Redis,
  intervalMs: number,
): CountersFlushWorker {
  let timer: NodeJS.Timeout | null = null

  async function flushOnce(): Promise<number> {
    // SPOP claims each id atomically before reading its hash: a like that
    // races in between re-adds the id to the dirty set (SADD on a claimed
    // id is a fresh insert again), so it's picked up on the next tick
    // instead of being silently dropped — SMEMBERS + SREM would lose it.
    const dirtyIds = await redis.spop(DIRTY_POST_COUNTERS_KEY, FLUSH_BATCH_SIZE)
    for (const postIdStr of dirtyIds) {
      const raw = await redis.hgetall(postCountersKey(postIdStr))
      if (Object.keys(raw).length > 0) {
        await repository.flushCounters(BigInt(postIdStr), parseCounterHash(raw))
      }
    }
    return dirtyIds.length
  }

  return {
    flushOnce,
    start() {
      timer = setInterval(() => {
        flushOnce().catch((error: unknown) => {
          console.error('counters flush failed:', error)
        })
      }, intervalMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
