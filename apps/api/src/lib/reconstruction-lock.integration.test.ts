import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { Redis } from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { withReconstructionLock } from './reconstruction-lock.js'

describe('withReconstructionLock', () => {
  let container: StartedRedisContainer
  let redis: Redis

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start()
    redis = new Redis(container.getConnectionUrl())
  }, 60_000)

  afterAll(async () => {
    await redis.quit()
    await container.stop()
  })

  afterEach(async () => {
    await redis.flushall()
  })

  it('runs rebuild directly when nothing else holds the lock', async () => {
    const result = await withReconstructionLock(
      redis,
      'test:lock',
      async () => 'rebuilt',
      async () => null,
    )
    expect(result).toBe('rebuilt')
  })

  it('lets exactly one of many concurrent callers actually rebuild, real Redis race', async () => {
    let rebuildCount = 0
    // A shared "cache" this test's own readCached reads from — populated
    // only by whichever caller's rebuild actually runs, the same shape a
    // real cache-backed readCached (e.g. timeline.repository.ts's own
    // readPrecomputed) would have.
    let cached: string | null = null

    async function rebuild(): Promise<string> {
      rebuildCount++
      // A real multi-join Postgres query takes measurable time — long
      // enough that, without the lock, 20 concurrent callers would
      // otherwise all be mid-rebuild at once.
      await new Promise((resolve) => setTimeout(resolve, 100))
      cached = 'rebuilt-value'
      return cached
    }
    async function readCached(): Promise<string | null> {
      return cached
    }

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        withReconstructionLock(redis, 'test:stampede', rebuild, readCached),
      ),
    )

    expect(rebuildCount).toBe(1) // the actual point of this test
    expect(results).toEqual(Array(20).fill('rebuilt-value')) // every caller still got the right answer
  })

  it('releases the lock as soon as rebuild finishes, not held for the full TTL', async () => {
    await withReconstructionLock(
      redis,
      'test:release',
      async () => 'done',
      async () => null,
      { lockTtlMs: 5000 },
    )
    // If the lock were still held, this second, independent call would
    // have to wait out the 5s TTL before it could claim it — it doesn't.
    const startedAt = Date.now()
    const result = await withReconstructionLock(
      redis,
      'test:release',
      async () => 'done-again',
      async () => null,
      { lockTtlMs: 5000 },
    )
    expect(result).toBe('done-again')
    expect(Date.now() - startedAt).toBeLessThan(1000)
  })

  it('falls through to rebuilding itself if the lock-holder never finishes within maxWaitMs', async () => {
    // Claim the lock and never release it — simulates a crashed rebuild.
    await redis.set('test:stuck:lock', '1', 'PX', 10_000, 'NX')

    const result = await withReconstructionLock(
      redis,
      'test:stuck:lock',
      async () => 'rebuilt-by-waiter',
      async () => null, // never sees a result from the "stuck" winner
      { maxWaitMs: 200, pollIntervalMs: 20 },
    )

    expect(result).toBe('rebuilt-by-waiter')
  })
})
