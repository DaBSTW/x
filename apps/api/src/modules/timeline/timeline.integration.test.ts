import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, migrationsFolderUrl, userCounters } from '@x/db'
import { timelineKey } from '@x/utils'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

describe('timeline routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let app: FastifyInstance

  async function registerAndLogin(username: string) {
    const email = `${username}@example.com`
    const password = `a unique passphrase for ${username} 7q`
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username, email, password, birthDate: '1990-01-01' },
    })
    const userId = registerResponse.json().data.id as string

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    })
    const accessToken = loginResponse.json().data.accessToken as string
    return { accessToken, userId }
  }

  async function follow(accessToken: string, targetUserId: string) {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/users/${targetUserId}/follow`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(response.statusCode).toBe(204)
  }

  async function createPost(accessToken: string, text: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { text },
    })
    expect(response.statusCode).toBe(201)
    return response.json().data as { id: string }
  }

  beforeAll(async () => {
    ;[postgresContainer, redisContainer, mailpitContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      new GenericContainer('axllent/mailpit:latest')
        .withExposedPorts(1025, 8025)
        .withWaitStrategy(Wait.forListeningPorts())
        .start(),
    ])

    const migrationDb = createDatabase(postgresContainer.getConnectionUri())
    await migrate(migrationDb, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    const env: Env = {
      NODE_ENV: 'test',
      API_PORT: 0,
      WEB_URL: 'http://localhost:3000',
      CORS_ORIGIN: 'http://localhost:3000',
      WORKER_ID: 4,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      JWT_ACCESS_TTL_MINUTES: 15,
      REFRESH_TOKEN_TTL_DAYS: 30,
      SMTP_HOST: mailpitContainer.getHost(),
      SMTP_PORT: mailpitContainer.getMappedPort(1025),
      MAIL_FROM: 'no-reply@x.example.com',
    }
    app = await buildApp(env)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), mailpitContainer.stop()])
  })

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/timeline/home' })
    expect(response.statusCode).toBe(401)
  })

  it('lazily reconstructs a cold timeline from Postgres', async () => {
    // No worker runs in this test process, so bob's post never reaches
    // Redis via fan-out — alice's read must fall back to reconstruction.
    const alice = await registerAndLogin('coldalice')
    const bob = await registerAndLogin('coldbob')
    await follow(alice.accessToken, bob.userId)
    const post = await createPost(bob.accessToken, 'hola desde bob (cold)')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/timeline/home',
      headers: { authorization: `Bearer ${alice.accessToken}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.map((p: { id: string }) => p.id)).toContain(post.id)
    expect(await app.redis.exists(timelineKey(BigInt(alice.userId)))).toBe(1)
  })

  it('reads a warm precomputed timeline straight from Redis', async () => {
    const alice = await registerAndLogin('warmalice')
    const carol = await registerAndLogin('warmcarol')
    await follow(alice.accessToken, carol.userId)
    const post = await createPost(carol.accessToken, 'hola desde carol (warm)')

    // Simulates what apps/workers' fan-out worker would have already done.
    await app.redis.zadd(timelineKey(BigInt(alice.userId)), post.id, post.id)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/timeline/home',
      headers: { authorization: `Bearer ${alice.accessToken}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.map((p: { id: string }) => p.id)).toEqual([post.id])
  })

  it('merges in posts from followed celebrity accounts even without fan-out', async () => {
    const alice = await registerAndLogin('celebalice')
    const star = await registerAndLogin('bigstar')
    await app.db
      .update(userCounters)
      .set({ followersCount: 10_000 })
      .where(eq(userCounters.userId, BigInt(star.userId)))
    await follow(alice.accessToken, star.userId)
    const post = await createPost(star.accessToken, 'hola desde una celebridad')

    // The celebrity's timeline key must stay untouched — no fan-out for them.
    expect(await app.redis.exists(timelineKey(BigInt(star.userId)))).toBe(0)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/timeline/home',
      headers: { authorization: `Bearer ${alice.accessToken}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.map((p: { id: string }) => p.id)).toContain(post.id)
  })
})
