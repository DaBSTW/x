import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, migrationsFolderUrl } from '@x/db'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

describe('posts routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let app: FastifyInstance
  let accessToken: string

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
      WORKER_ID: 2,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      JWT_ACCESS_TTL_MINUTES: 15,
      REFRESH_TOKEN_TTL_DAYS: 30,
      SMTP_HOST: mailpitContainer.getHost(),
      SMTP_PORT: mailpitContainer.getMappedPort(1025),
      MAIL_FROM: 'no-reply@x.example.com',
    }
    app = await buildApp(env)

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'poster',
        email: 'poster@example.com',
        password: 'a genuinely unique passphrase 9x2',
        birthDate: '1990-01-01',
      },
    })
    expect(registerResponse.statusCode).toBe(201)

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'poster@example.com', password: 'a genuinely unique passphrase 9x2' },
    })
    expect(loginResponse.statusCode).toBe(200)
    accessToken = loginResponse.json().data.accessToken
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), mailpitContainer.stop()])
  })

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` }
  }

  it('creates, fetches, and soft-deletes a post', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'hola mundo desde el test de integración #dev' },
    })
    expect(createResponse.statusCode).toBe(201)
    const post = createResponse.json().data
    expect(post.text).toContain('hola mundo')
    expect(post.entities).toContainEqual(expect.objectContaining({ kind: 'hashtag', value: 'dev' }))

    const getResponse = await app.inject({ method: 'GET', url: `/v1/posts/${post.id}` })
    expect(getResponse.statusCode).toBe(200)
    expect(getResponse.json().data.id).toBe(post.id)

    // A different (unauthenticated) caller can't delete it.
    const unauthorizedDelete = await app.inject({ method: 'DELETE', url: `/v1/posts/${post.id}` })
    expect(unauthorizedDelete.statusCode).toBe(401)

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/posts/${post.id}`,
      headers: authHeader(),
    })
    expect(deleteResponse.statusCode).toBe(204)

    const getAfterDelete = await app.inject({ method: 'GET', url: `/v1/posts/${post.id}` })
    expect(getAfterDelete.statusCode).toBe(404)
  })

  it('returns 400 for a post with no text', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: {},
    })
    expect(response.statusCode).toBe(400)
  })

  it('dedupes creates that share an Idempotency-Key', async () => {
    const idempotencyKey = randomUUID()
    const payload = { text: 'un post idempotente' }

    const first = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { ...authHeader(), 'idempotency-key': idempotencyKey },
      payload,
    })
    const second = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { ...authHeader(), 'idempotency-key': idempotencyKey },
      payload,
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(first.json().data.id).toBe(second.json().data.id)
  })

  it('resolves a reply thread through conversationId', async () => {
    const rootResponse = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'raíz del hilo' },
    })
    const root = rootResponse.json().data

    const replyResponse = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'una respuesta', inReplyToId: root.id },
    })
    expect(replyResponse.statusCode).toBe(201)
    expect(replyResponse.json().data.conversationId).toBe(root.id)
  })

  it('paginates a user timeline by cursor', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: authHeader(),
        payload: { text: `post de paginación ${i}` },
      })
    }

    const firstPage = await app.inject({ method: 'GET', url: '/v1/users/poster/posts?limit=2' })
    expect(firstPage.statusCode).toBe(200)
    const firstBody = firstPage.json()
    expect(firstBody.data).toHaveLength(2)
    expect(firstBody.meta.hasMore).toBe(true)
    expect(firstBody.meta.nextCursor).toBeTruthy()

    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/users/poster/posts?limit=2&cursor=${encodeURIComponent(firstBody.meta.nextCursor)}`,
    })
    expect(secondPage.statusCode).toBe(200)
    const secondIds = new Set(secondPage.json().data.map((p: { id: string }) => p.id))
    const firstIds = new Set(firstBody.data.map((p: { id: string }) => p.id))
    for (const id of secondIds) {
      expect(firstIds.has(id)).toBe(false)
    }
  })

  it('returns 404 for a nonexistent username', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users/ghost-user/posts' })
    expect(response.statusCode).toBe(404)
  })
})
