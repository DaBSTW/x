import type { Redis } from 'ioredis'

// SPECS.md §14.1's own "SET NX PX 5000".
const DEFAULT_LOCK_TTL_MS = 5000
const DEFAULT_POLL_INTERVAL_MS = 50

export type ReconstructionLockOptions = {
  lockTtlMs?: number
  pollIntervalMs?: number
  /** How long a caller that lost the race waits for the winner before giving up and rebuilding itself. Defaults to lockTtlMs — long enough that a healthy winner has always finished, short enough that a crashed one doesn't wedge every waiter. */
  maxWaitMs?: number
}

/**
 * SPECS.md §14.1's anti-stampede reconstruction lock. When a cache entry
 * goes cold, many concurrent readers can otherwise all race to rebuild it
 * from Postgres at once (e.g. `timeline.repository.ts`'s own
 * `reconstructFromPostgres`, a multi-day join, hit by every tab/device a
 * user has open the moment their timeline expires) — this caps that to at
 * most one concurrent rebuild per `lockKey`; everyone else waits briefly
 * and re-reads via `readCached` instead of redoing the same expensive work.
 *
 * A caller that loses the lock race polls `readCached` until it returns
 * non-null or `maxWaitMs` elapses. If the lock-holder never finishes in
 * time (a crash mid-rebuild — the lock itself still expires via its own
 * TTL, so this isn't a permanent wedge either way), a waiter falls through
 * and rebuilds itself rather than hanging forever: a second concurrent
 * rebuild in that rare case is a real but bounded cost, not a correctness
 * problem, everywhere this is used rebuilding is idempotent.
 */
export async function withReconstructionLock<T>(
  redis: Redis,
  lockKey: string,
  rebuild: () => Promise<T>,
  readCached: () => Promise<T | null>,
  options: ReconstructionLockOptions = {},
): Promise<T> {
  const lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const maxWaitMs = options.maxWaitMs ?? lockTtlMs

  const claimed = await redis.set(lockKey, '1', 'PX', lockTtlMs, 'NX')
  if (claimed === 'OK') {
    try {
      return await rebuild()
    } finally {
      // Released as soon as the rebuild finishes, not held for the full
      // TTL — the next cold read (well past this one) shouldn't wait out a
      // lock nothing is still using.
      await redis.del(lockKey)
    }
  }

  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    const cached = await readCached()
    if (cached !== null) return cached
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  return rebuild()
}
