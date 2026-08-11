import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { RateLimitError } from '@x/utils'
import { Redis } from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  assertLoginNotBackedOff,
  clearLoginFailures,
  enforceRateLimit,
  recordLoginFailure,
} from './rate-limit.js'

describe('rate-limit', () => {
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

  describe('enforceRateLimit', () => {
    it('allows requests under the limit', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(enforceRateLimit(redis, 'test:key', 5, 60_000)).resolves.toBeUndefined()
      }
    })

    it('throws RateLimitError once the limit is exceeded', async () => {
      for (let i = 0; i < 3; i++) {
        await enforceRateLimit(redis, 'test:key', 3, 60_000)
      }

      await expect(enforceRateLimit(redis, 'test:key', 3, 60_000)).rejects.toBeInstanceOf(
        RateLimitError,
      )
    })

    it('tracks distinct keys independently', async () => {
      await enforceRateLimit(redis, 'ip:1.1.1.1', 1, 60_000)
      await expect(enforceRateLimit(redis, 'ip:2.2.2.2', 1, 60_000)).resolves.toBeUndefined()
      await expect(enforceRateLimit(redis, 'ip:1.1.1.1', 1, 60_000)).rejects.toBeInstanceOf(
        RateLimitError,
      )
    })

    it('resets after the window expires', async () => {
      await enforceRateLimit(redis, 'test:short-window', 1, 200)
      await expect(enforceRateLimit(redis, 'test:short-window', 1, 200)).rejects.toBeInstanceOf(
        RateLimitError,
      )

      await new Promise((resolve) => setTimeout(resolve, 300))

      await expect(enforceRateLimit(redis, 'test:short-window', 1, 200)).resolves.toBeUndefined()
    })
  })

  describe('login backoff', () => {
    it('does not block an account with no recorded failures', async () => {
      await expect(assertLoginNotBackedOff(redis, 'ana@example.com')).resolves.toBeUndefined()
    })

    it('blocks the account after a failure, then clears on success', async () => {
      await recordLoginFailure(redis, 'ana@example.com')

      await expect(assertLoginNotBackedOff(redis, 'ana@example.com')).rejects.toBeInstanceOf(
        RateLimitError,
      )

      await clearLoginFailures(redis, 'ana@example.com')
      await expect(assertLoginNotBackedOff(redis, 'ana@example.com')).resolves.toBeUndefined()
    })

    it('grows the backoff window exponentially with repeated failures', async () => {
      await recordLoginFailure(redis, 'bob@example.com')
      const firstBlockedUntil = Number(await redis.get('login:blocked:bob@example.com'))

      await recordLoginFailure(redis, 'bob@example.com')
      const secondBlockedUntil = Number(await redis.get('login:blocked:bob@example.com'))

      expect(secondBlockedUntil - Date.now()).toBeGreaterThan(firstBlockedUntil - Date.now())
    })
  })
})
