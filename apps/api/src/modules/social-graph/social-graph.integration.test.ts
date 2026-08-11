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

describe('social graph routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let app: FastifyInstance
  let aliceToken: string
  let aliceId: string
  let bobId: string

  async function registerAndLogin(username: string, email: string) {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username,
        email,
        password: `a unique passphrase for ${username} 7q`,
        birthDate: '1990-01-01',
      },
    })
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: `a unique passphrase for ${username} 7q` },
    })
    const body = loginResponse.json()
    return { accessToken: body.data.accessToken as string }
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
      WORKER_ID: 3,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      JWT_ACCESS_TTL_MINUTES: 15,
      REFRESH_TOKEN_TTL_DAYS: 30,
      SMTP_HOST: mailpitContainer.getHost(),
      SMTP_PORT: mailpitContainer.getMappedPort(1025),
      MAIL_FROM: 'no-reply@x.example.com',
    }
    app = await buildApp(env)

    const alice = await registerAndLogin('alice', 'alice@example.com')
    aliceToken = alice.accessToken

    const bob = await registerAndLogin('bob', 'bob@example.com')
    const bobPost = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { text: 'hola desde bob' },
    })
    bobId = bobPost.json().data.author.id
    const alicePost = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { text: 'hola desde alice' },
    })
    aliceId = alicePost.json().data.author.id
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), mailpitContainer.stop()])
  })

  it('follows, lists, and unfollows', async () => {
    const followResponse = await app.inject({
      method: 'POST',
      url: `/v1/users/${bobId}/follow`,
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(followResponse.statusCode).toBe(204)

    const duplicateFollow = await app.inject({
      method: 'POST',
      url: `/v1/users/${bobId}/follow`,
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(duplicateFollow.statusCode).toBe(409)

    const followingResponse = await app.inject({ method: 'GET', url: '/v1/users/alice/following' })
    expect(followingResponse.statusCode).toBe(200)
    expect(followingResponse.json().data.map((u: { username: string }) => u.username)).toContain(
      'bob',
    )

    const followersResponse = await app.inject({ method: 'GET', url: '/v1/users/bob/followers' })
    expect(followersResponse.json().data.map((u: { username: string }) => u.username)).toContain(
      'alice',
    )

    const unfollowResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${bobId}/follow`,
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(unfollowResponse.statusCode).toBe(204)

    const followingAfter = await app.inject({ method: 'GET', url: '/v1/users/alice/following' })
    expect(followingAfter.json().data.map((u: { username: string }) => u.username)).not.toContain(
      'bob',
    )
  })

  it('rejects following yourself', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/users/${aliceId}/follow`,
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(response.statusCode).toBe(400)
  })

  it('requires authentication to follow', async () => {
    const response = await app.inject({ method: 'POST', url: `/v1/users/${bobId}/follow` })
    expect(response.statusCode).toBe(401)
  })

  it('suggests accounts the caller does not already follow', async () => {
    await registerAndLogin('suggdave', 'suggdave@example.com')
    await registerAndLogin('suggerin', 'suggerin@example.com')
    const daveProfile = await app.inject({ method: 'GET', url: '/v1/users/suggdave' })
    const daveId = daveProfile.json().data.id as string
    await app.inject({
      method: 'POST',
      url: `/v1/users/${daveId}/follow`,
      headers: { authorization: `Bearer ${aliceToken}` },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/suggestions',
      headers: { authorization: `Bearer ${aliceToken}` },
    })

    expect(response.statusCode).toBe(200)
    const usernames = response.json().data.map((u: { username: string }) => u.username)
    expect(usernames).not.toContain('suggdave') // already followed
    expect(usernames).not.toContain('alice') // the viewer themself
    expect(usernames).toContain('suggerin') // not followed yet — a valid suggestion
  })

  it('requires authentication for suggestions', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users/suggestions' })
    expect(response.statusCode).toBe(401)
  })
})
