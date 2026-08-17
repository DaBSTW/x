import { REDIS_TIMEOUT_MS } from '@x/utils'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { Redis } from 'ioredis'

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

export type RedisPluginOptions = {
  redisUrl: string
}

export default fp(async function redisPlugin(app: FastifyInstance, options: RedisPluginOptions) {
  const redis = new Redis(options.redisUrl, {
    // Fail fast instead of queuing commands indefinitely against a dead
    // Redis — CODESTYLE.md §10 / SPECS.md §14.4 (explicit timeouts on every
    // call, "Redis 200 ms"). connectTimeout bounds establishing the TCP
    // connection itself; commandTimeout is the one that actually matches
    // "Redis 200 ms" — every command issued on this connection (GET, SET,
    // the Lua scripts idempotency.ts/rate-limit.ts run, ...) rejects with
    // "Command timed out" if Redis doesn't answer within it, instead of
    // this process waiting indefinitely on a Redis that's up but wedged.
    connectTimeout: 2_000,
    commandTimeout: REDIS_TIMEOUT_MS,
    maxRetriesPerRequest: 3,
  })

  app.decorate('redis', redis)
  app.addHook('onClose', async () => {
    await redis.quit()
  })
})
