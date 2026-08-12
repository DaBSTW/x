import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, migrationsFolderUrl } from '@x/db'
import { realtimeTicketKey, sha256Hex } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

describe('realtime routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let app: FastifyInstance
  let redis: Redis
  let aliceToken: string
  let aliceId: string

  async function registerAndLogin(username: string) {
    const email = `${username}@example.com`
    const password = `a unique passphrase for ${username} 7q`
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username, email, password, birthDate: '1990-01-01' },
    })
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    })
    return {
      accessToken: loginResponse.json().data.accessToken as string,
      userId: registerResponse.json().data.id as string,
    }
  }

  beforeAll(async () => {
    ;[postgresContainer, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ])

    const migrationDb = createDatabase(postgresContainer.getConnectionUri())
    await migrate(migrationDb, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    const env: Env = {
      NODE_ENV: 'test',
      API_PORT: 0,
      WEB_URL: 'http://localhost:3000',
      CORS_ORIGIN: 'http://localhost:3000',
      WORKER_ID: 9,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      JWT_ACCESS_TTL_MINUTES: 15,
      REFRESH_TOKEN_TTL_DAYS: 30,
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      MAIL_FROM: 'no-reply@x.example.com',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'x-media',
      S3_ACCESS_KEY_ID: 'x-minio',
      S3_SECRET_ACCESS_KEY: 'x-minio-secret',
      S3_FORCE_PATH_STYLE: true,
    }
    app = await buildApp(env)
    redis = new Redis(redisContainer.getConnectionUrl())

    const alice = await registerAndLogin('alice')
    aliceToken = alice.accessToken
    aliceId = alice.userId
  }, 120_000)

  afterAll(async () => {
    redis.disconnect()
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop()])
  })

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/realtime/ticket' })
    expect(response.statusCode).toBe(401)
  })

  it('issues a one-time ticket resolvable to the caller under the shared Redis key format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/realtime/ticket',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(response.statusCode).toBe(200)

    const { ticket, expiresIn } = response.json().data
    expect(expiresIn).toBe(60)

    // apps/ws-gateway redeems it with GETDEL on this exact key — proving the
    // route writes the format the other service's own tests independently
    // pin (realtime.test.ts in @x/utils), without either app importing the
    // other (CODESTYLE.md §7).
    const key = realtimeTicketKey(sha256Hex(ticket))
    expect(await redis.get(key)).toBe(aliceId)
    const ttl = await redis.ttl(key)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60)
  })

  it('issues a different ticket on every call', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/realtime/ticket',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    const second = await app.inject({
      method: 'POST',
      url: '/v1/realtime/ticket',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(first.json().data.ticket).not.toBe(second.json().data.ticket)
  })
})
