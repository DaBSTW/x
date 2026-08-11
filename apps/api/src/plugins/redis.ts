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
    // Redis — CODESTYLE.md §10 (explicit timeouts on every external call).
    connectTimeout: 2_000,
    maxRetriesPerRequest: 3,
  })

  app.decorate('redis', redis)
  app.addHook('onClose', async () => {
    await redis.quit()
  })
})
