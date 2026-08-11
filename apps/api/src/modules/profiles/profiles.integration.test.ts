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

describe('profiles routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let app: FastifyInstance
  let aliceToken: string

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
      WORKER_ID: 6,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      JWT_ACCESS_TTL_MINUTES: 15,
      REFRESH_TOKEN_TTL_DAYS: 30,
      SMTP_HOST: mailpitContainer.getHost(),
      SMTP_PORT: mailpitContainer.getMappedPort(1025),
      MAIL_FROM: 'no-reply@x.example.com',
    }
    app = await buildApp(env)

    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'alice',
        email: 'alice@example.com',
        password: 'a unique passphrase for alice 7q',
        birthDate: '1990-01-01',
      },
    })
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'alice@example.com', password: 'a unique passphrase for alice 7q' },
    })
    aliceToken = login.json().data.accessToken
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), mailpitContainer.stop()])
  })

  it('returns a public profile with zeroed counters for a fresh user', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users/alice' })

    expect(response.statusCode).toBe(200)
    const profile = response.json().data
    expect(profile.username).toBe('alice')
    expect(profile.counters).toEqual({ followers: 0, following: 0, posts: 0 })
  })

  it('GET /users/me returns the authenticated user, not a user literally named "me"', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.username).toBe('alice')
  })

  it('GET /users/me requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users/me' })
    expect(response.statusCode).toBe(401)
  })

  it('is case-insensitive on username', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users/ALICE' })
    expect(response.statusCode).toBe(200)
  })

  it('returns 404 for an unknown username', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users/ghost-user' })
    expect(response.statusCode).toBe(404)
  })

  it('reflects a post in the counters, and its deletion', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { text: 'hola' },
    })
    const postId = created.json().data.id

    const afterCreate = await app.inject({ method: 'GET', url: '/v1/users/alice' })
    expect(afterCreate.json().data.counters.posts).toBe(1)

    await app.inject({
      method: 'DELETE',
      url: `/v1/posts/${postId}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    })

    const afterDelete = await app.inject({ method: 'GET', url: '/v1/users/alice' })
    expect(afterDelete.json().data.counters.posts).toBe(0)
  })

  it('updates the authenticated user’s own profile', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { bio: 'hola, soy alice', location: 'Madrid' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({ bio: 'hola, soy alice', location: 'Madrid' })

    const fetched = await app.inject({ method: 'GET', url: '/v1/users/alice' })
    expect(fetched.json().data.bio).toBe('hola, soy alice')
  })

  it('requires authentication to update a profile', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      payload: { bio: 'x' },
    })
    expect(response.statusCode).toBe(401)
  })
})
