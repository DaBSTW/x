import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, migrationsFolderUrl } from '@x/db'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import type { Env } from '../env.js'

const READ_YOUR_WRITES_COOKIE_NAME = 'read_your_writes'

function getCookie(
  response: { cookies: Array<{ name: string; value: string; maxAge?: number }> },
  name: string,
) {
  return response.cookies.find((cookie) => cookie.name === name)
}

/**
 * ROADMAP.md 3.4d / SPECS.md §14.2's per-request half — the plugin's own
 * comment explains the split with packages/db's createReplicatedDatabase,
 * which is what this file does NOT exercise: no replica is configured here
 * (replicated-client.integration.test.ts already proves the actual primary/
 * replica picking against a real streaming replica), this file is only
 * about whether the cookie itself gets read/set correctly over real HTTP.
 */
describe('read-write-routing plugin', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let app: FastifyInstance

  async function registerAndLogin(username: string) {
    const email = `${username}@example.com`
    const password = `a unique passphrase for ${username} 7q`
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username, email, password, birthDate: '1990-01-01' },
    })
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    })
    return loginResponse.json().data.accessToken as string
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
      WORKER_ID: 5,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      KAFKA_BROKERS: 'localhost:9092',
      JWT_ACCESS_TTL_MINUTES: 15,
      REFRESH_TOKEN_TTL_DAYS: 30,
      SMTP_HOST: mailpitContainer.getHost(),
      SMTP_PORT: mailpitContainer.getMappedPort(1025),
      MAIL_FROM: 'no-reply@x.example.com',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'x-media',
      S3_ACCESS_KEY_ID: 'x-minio',
      S3_SECRET_ACCESS_KEY: 'x-minio-secret',
      S3_FORCE_PATH_STYLE: true,
      OPENSEARCH_URL: 'http://localhost:9200',
      // This file registers several of its own users across its tests —
      // same reasoning as lists.integration.test.ts's own LOGIN_RATE_LIMIT_MAX.
      LOGIN_RATE_LIMIT_MAX: 100,
    }
    app = await buildApp(env)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), mailpitContainer.stop()])
  })

  it('does not set the cookie on a plain read-only request', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(getCookie(response, READ_YOUR_WRITES_COOKIE_NAME)).toBeUndefined()
  })

  it('sets a 5s read-your-writes cookie on a request that writes (register)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'rywregister',
        email: 'rywregister@example.com',
        password: 'a unique passphrase for rywregister 7q',
        birthDate: '1990-01-01',
      },
    })
    expect(response.statusCode).toBe(201)

    const cookie = getCookie(response, READ_YOUR_WRITES_COOKIE_NAME)
    expect(cookie).toBeTruthy()
    expect(cookie?.maxAge).toBe(5)
  })

  it('sets the cookie on other write routes too (creating a post), not just auth', async () => {
    const accessToken = await registerAndLogin('rywposter')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { text: 'read-your-writes plugin coverage' },
    })
    expect(response.statusCode).toBe(201)
    expect(getCookie(response, READ_YOUR_WRITES_COOKIE_NAME)).toBeTruthy()
  })

  it('does not refresh the cookie on a read that merely arrives already carrying it', async () => {
    const accessToken = await registerAndLogin('rywreader')

    // Arrives with the cookie already set (as if within an earlier
    // request's 5 s window) but performs no write of its own.
    const response = await app.inject({
      method: 'GET',
      url: '/v1/timeline/home',
      headers: { authorization: `Bearer ${accessToken}` },
      cookies: { [READ_YOUR_WRITES_COOKIE_NAME]: '1' },
    })
    expect(response.statusCode).toBe(200)
    // No Set-Cookie for this name at all — a request that only reads must
    // let an already-present cookie run out on its own, never extend it
    // (SPECS.md §14.2's "durante 5 s tras una escritura" is anchored to the
    // last *write*, not the last read).
    expect(getCookie(response, READ_YOUR_WRITES_COOKIE_NAME)).toBeUndefined()
  })

  it('a read-only request never sees the cookie set, even one that 404s or 401s', async () => {
    const unauthenticated = await app.inject({ method: 'GET', url: '/v1/timeline/home' })
    expect(unauthenticated.statusCode).toBe(401)
    expect(getCookie(unauthenticated, READ_YOUR_WRITES_COOKIE_NAME)).toBeUndefined()
  })
})
