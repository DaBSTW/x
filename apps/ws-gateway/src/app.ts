import websocket from '@fastify/websocket'
import { createDatabase } from '@x/db'
import Fastify, { type FastifyInstance } from 'fastify'
import { Redis } from 'ioredis'
import type { Env } from './env.js'
import { createConnectionRegistry } from './gateway/connection-registry.js'
import { registerGatewayRoutes } from './gateway/gateway.plugin.js'
import { createRealtimeRepository } from './gateway/realtime.repository.js'

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'test' ? 'silent' : 'info' },
    genReqId: () => crypto.randomUUID(),
  })

  await app.register(websocket)

  const db = createDatabase(env.DATABASE_URL)
  // Two Redis connections, not one: a connection that has issued SUBSCRIBE
  // can't issue any other command (ioredis's own documented restriction),
  // and the ticket GETDEL on every connect needs the other kind.
  const redis = new Redis(env.REDIS_URL, { connectTimeout: 2_000, maxRetriesPerRequest: 3 })
  const subscriber = new Redis(env.REDIS_URL, { connectTimeout: 2_000, maxRetriesPerRequest: 3 })
  app.addHook('onClose', () => {
    redis.disconnect()
    subscriber.disconnect()
  })

  app.get('/health', async () => ({ status: 'ok' }))

  await registerGatewayRoutes(app, {
    redis,
    subscriber,
    registry: createConnectionRegistry(),
    repository: createRealtimeRepository(db),
    corsOrigin: env.CORS_ORIGIN,
    heartbeatIntervalMs: env.HEARTBEAT_INTERVAL_MS,
    heartbeatTimeoutMs: env.HEARTBEAT_TIMEOUT_MS,
    backpressureLimitBytes: env.BACKPRESSURE_LIMIT_BYTES,
  })

  return app
}
