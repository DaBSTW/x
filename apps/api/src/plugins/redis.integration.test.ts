import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { REDIS_TIMEOUT_MS } from '@x/utils'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * ROADMAP.md 3.5a / SPECS.md §14.4's "Redis 200 ms" — proves
 * redis.ts's own `commandTimeout` option is real, not just a value threaded
 * through and never actually observed firing. `BLPOP` against a key nobody
 * ever pushes to is a real Redis command that genuinely has no reply coming
 * for its own timeout window — the server is honestly still waiting, not
 * artificially slow (DEBUG SLEEP would be the more direct analogue to
 * client.timeouts.integration.test.ts's own `pg_sleep`, but modern Redis
 * images disable DEBUG by default; BLPOP needs no special server config and
 * is a real blocking pattern this codebase's own BullMQ connections
 * legitimately rely on elsewhere — see server.ts's own comment on why
 * *those* connections deliberately don't set this option).
 */
describe('redis commandTimeout', () => {
  let container: StartedRedisContainer

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start()
  }, 60_000)

  afterAll(async () => {
    await container.stop()
  })

  it('rejects a command the server genuinely has no reply for yet, once the configured timeout elapses', async () => {
    const redis = new Redis(container.getConnectionUrl(), { commandTimeout: REDIS_TIMEOUT_MS })
    const startedAt = Date.now()

    // Blocks for up to 2s waiting for a push that never comes — a real,
    // still-pending command, not a client-side fake.
    await expect(redis.blpop('nobody-pushes-here', 2)).rejects.toThrow('Command timed out')
    // Real proof this fired near REDIS_TIMEOUT_MS, not near the full 2s
    // BLPOP itself was told to wait.
    expect(Date.now() - startedAt).toBeLessThan(1000)

    redis.disconnect()
  })

  it('never touches a command that answers well inside the budget (no false positives)', async () => {
    const redis = new Redis(container.getConnectionUrl(), { commandTimeout: REDIS_TIMEOUT_MS })
    await expect(redis.set('k', 'v')).resolves.toBe('OK')
    await expect(redis.get('k')).resolves.toBe('v')
    redis.disconnect()
  })

  it('a connection without commandTimeout configured is never bounded by it (BullMQ connections’ own posture)', async () => {
    const redis = new Redis(container.getConnectionUrl())
    // Genuinely slower than REDIS_TIMEOUT_MS, and this time actually
    // fulfilled rather than left to expire — proves the *absence* of the
    // option really means unbounded, not a shorter default this file's
    // other tests happen not to hit.
    const blocked = redis.blpop('another-key', 2)
    const pusher = new Redis(container.getConnectionUrl())
    await new Promise((resolve) => setTimeout(resolve, 500))
    await pusher.lpush('another-key', 'value')
    await expect(blocked).resolves.toEqual(['another-key', 'value'])
    pusher.disconnect()
    redis.disconnect()
  })
})
