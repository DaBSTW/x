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

// Full auth cycle against real Postgres, Redis and an SMTP server (Mailpit) —
// CODESTYLE.md §14 forbids mocking the database, and the same principle
// applies to the other externally-observable side effect this module has:
// sending the verification email.
describe('auth end-to-end cycle', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let app: FastifyInstance
  let mailpitApiUrl: string

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

    mailpitApiUrl = `http://${mailpitContainer.getHost()}:${mailpitContainer.getMappedPort(8025)}`

    const env: Env = {
      NODE_ENV: 'test',
      API_PORT: 0,
      WEB_URL: 'http://localhost:3000',
      CORS_ORIGIN: 'http://localhost:3000',
      WORKER_ID: 1,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
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
    }
    app = await buildApp(env)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), mailpitContainer.stop()])
  })

  it('runs register → verify → login → refresh → reuse detected → logout', async () => {
    // 1. Register
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'ana_dev',
        email: 'ana@example.com',
        password: 'vX7qk-unique-test-passphrase-42',
        birthDate: '1990-01-01',
      },
    })
    expect(registerResponse.statusCode).toBe(201)
    const registerBody = registerResponse.json()
    expect(registerBody.data.emailVerified).toBe(false)

    // Registering the same email again is a conflict, not a silent success.
    const duplicateResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'someone_else',
        email: 'ana@example.com',
        password: 'vX7qk-unique-test-passphrase-42',
        birthDate: '1990-01-01',
      },
    })
    expect(duplicateResponse.statusCode).toBe(409)

    // 2. Verify — recover the token from the email Mailpit received.
    const verificationToken = await waitForVerificationToken(mailpitApiUrl)
    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      payload: { token: verificationToken },
    })
    expect(verifyResponse.statusCode).toBe(200)

    // An already-used token is rejected on a second attempt.
    const reusedVerifyResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      payload: { token: verificationToken },
    })
    expect(reusedVerifyResponse.statusCode).toBe(422)

    // 3. Login
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'ana@example.com', password: 'vX7qk-unique-test-passphrase-42' },
    })
    expect(loginResponse.statusCode).toBe(200)
    const { accessToken } = loginResponse.json().data
    expect(typeof accessToken).toBe('string')

    const refreshCookie = getCookie(loginResponse, 'refresh_token')
    expect(refreshCookie).toBeTruthy()

    // A wrong password is rejected without revealing whether the account exists.
    const badLoginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'ana@example.com', password: 'wrong password entirely' },
    })
    expect(badLoginResponse.statusCode).toBe(401)

    // Authenticated route works with the issued access token.
    const sessionsResponse = await app.inject({
      method: 'GET',
      url: '/v1/auth/sessions',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(sessionsResponse.statusCode).toBe(200)
    expect(sessionsResponse.json().data).toHaveLength(1)
    expect(sessionsResponse.json().data[0].isCurrent).toBe(true)

    // 4. Refresh — rotates the refresh token and issues a new access token.
    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { refresh_token: refreshCookie ?? '' },
    })
    expect(refreshResponse.statusCode).toBe(200)
    const rotatedCookie = getCookie(refreshResponse, 'refresh_token')
    expect(rotatedCookie).toBeTruthy()
    expect(rotatedCookie).not.toBe(refreshCookie)

    // 5. Reuse detected — presenting the now-superseded token revokes the family.
    const reuseResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { refresh_token: refreshCookie ?? '' },
    })
    expect(reuseResponse.statusCode).toBe(401)

    // The rotated (once-valid) token is now revoked too — the whole family died.
    const rotatedNowRevokedResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { refresh_token: rotatedCookie ?? '' },
    })
    expect(rotatedNowRevokedResponse.statusCode).toBe(401)

    // 6. Logout — a fresh login, then confirm the session actually ends.
    const secondLoginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'ana@example.com', password: 'vX7qk-unique-test-passphrase-42' },
    })
    const secondRefreshCookie = getCookie(secondLoginResponse, 'refresh_token')

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      cookies: { refresh_token: secondRefreshCookie ?? '' },
    })
    expect(logoutResponse.statusCode).toBe(204)

    const postLogoutRefreshResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { refresh_token: secondRefreshCookie ?? '' },
    })
    expect(postLogoutRefreshResponse.statusCode).toBe(401)
  })

  it('logout-all revokes every session for the user', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'multi_device',
        email: 'multi@example.com',
        password: 'vX7qk-unique-test-passphrase-42',
        birthDate: '1990-01-01',
      },
    })
    const verificationToken = await waitForVerificationToken(mailpitApiUrl, 'multi@example.com')
    await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      payload: { token: verificationToken },
    })

    const loginA = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'multi@example.com', password: 'vX7qk-unique-test-passphrase-42' },
    })
    const loginB = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'multi@example.com', password: 'vX7qk-unique-test-passphrase-42' },
    })
    const accessTokenA = loginA.json().data.accessToken
    const refreshCookieB = getCookie(loginB, 'refresh_token')

    const logoutAllResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout-all',
      headers: { authorization: `Bearer ${accessTokenA}` },
    })
    expect(logoutAllResponse.statusCode).toBe(204)

    const refreshAfterLogoutAll = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { refresh_token: refreshCookieB ?? '' },
    })
    expect(refreshAfterLogoutAll.statusCode).toBe(401)
  })
})

function getCookie(
  response: { cookies: Array<{ name: string; value: string }> },
  name: string,
): string | undefined {
  return response.cookies.find((cookie) => cookie.name === name)?.value
}

type MailpitMessagesResponse = { messages: Array<{ ID: string; To: Array<{ Address: string }> }> }
type MailpitMessageResponse = { HTML: string; Text: string }

async function waitForVerificationToken(
  mailpitApiUrl: string,
  toAddress?: string,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const listResponse = await fetch(`${mailpitApiUrl}/api/v1/messages`)
    const list = (await listResponse.json()) as MailpitMessagesResponse
    const message = toAddress
      ? list.messages.find((candidate) =>
          candidate.To.some((recipient) => recipient.Address === toAddress),
        )
      : list.messages[0]

    if (message) {
      const detailResponse = await fetch(`${mailpitApiUrl}/api/v1/message/${message.ID}`)
      const detail = (await detailResponse.json()) as MailpitMessageResponse
      const match = /token=([^"&\s]+)/.exec(detail.HTML || detail.Text)
      if (match?.[1]) {
        return decodeURIComponent(match[1])
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error('timed out waiting for verification email')
}
