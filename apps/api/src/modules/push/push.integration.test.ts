import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, deviceTokens, migrationsFolderUrl, pushSubscriptions } from '@x/db'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

describe('push routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let app: FastifyInstance
  let aliceToken: string
  let bobToken: string

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
      WORKER_ID: 8,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      // Placeholder — none of this file's tests exercise a Kafka-producing
      // route in a way that asserts on the message, so an unreachable broker
      // is fine (posts.service.ts/social-graph.service.ts already treat a
      // produce failure as non-fatal — ROADMAP.md 3.1).
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
      // Query-time only search route — none of this file's tests exercise /search,
      // so a real reachable OpenSearch isn't needed for the app to boot.
      OPENSEARCH_URL: 'http://localhost:9200',
      VAPID_PUBLIC_KEY: 'test-vapid-public-key',
    }
    app = await buildApp(env)

    aliceToken = await registerAndLogin('alice')
    bobToken = await registerAndLogin('bob')
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), mailpitContainer.stop()])
  })

  it('serves the configured VAPID public key without authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/push/vapid-public-key' })
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({ publicKey: 'test-vapid-public-key' })
  })

  it('requires authentication to subscribe or unsubscribe', async () => {
    const subscribe = await app.inject({
      method: 'POST',
      url: '/v1/push/subscriptions',
      payload: { endpoint: 'https://push.example.com/x', keys: { p256dh: 'p', auth: 'a' } },
    })
    const unsubscribe = await app.inject({
      method: 'DELETE',
      url: '/v1/push/subscriptions',
      payload: { endpoint: 'https://push.example.com/x' },
    })
    expect([subscribe.statusCode, unsubscribe.statusCode]).toEqual([401, 401])
  })

  it('subscribes, re-subscribing the same endpoint re-points it instead of duplicating, then unsubscribes', async () => {
    const db = createDatabase(postgresContainer.getConnectionUri())
    const endpoint = 'https://push.example.com/shared-browser'

    const aliceSubscribe = await app.inject({
      method: 'POST',
      url: '/v1/push/subscriptions',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { endpoint, keys: { p256dh: 'alice-p256dh', auth: 'alice-auth' } },
    })
    expect(aliceSubscribe.statusCode).toBe(204)

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.p256dh).toBe('alice-p256dh')

    // The same browser/endpoint now subscribes as bob (e.g. alice logged
    // out, bob logged in on the same device) — re-points, doesn't duplicate.
    const bobSubscribe = await app.inject({
      method: 'POST',
      url: '/v1/push/subscriptions',
      headers: { authorization: `Bearer ${bobToken}` },
      payload: { endpoint, keys: { p256dh: 'bob-p256dh', auth: 'bob-auth' } },
    })
    expect(bobSubscribe.statusCode).toBe(204)

    const afterResubscribe = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
    expect(afterResubscribe).toHaveLength(1)
    expect(afterResubscribe[0]?.p256dh).toBe('bob-p256dh')

    // alice can't unsubscribe a device that's now bob's.
    const aliceUnsubscribe = await app.inject({
      method: 'DELETE',
      url: '/v1/push/subscriptions',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { endpoint },
    })
    expect(aliceUnsubscribe.statusCode).toBe(204) // succeeds as a request, but...
    const stillThere = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
    expect(stillThere).toHaveLength(1) // ...nothing was deleted — it wasn't alice's row.

    const bobUnsubscribe = await app.inject({
      method: 'DELETE',
      url: '/v1/push/subscriptions',
      headers: { authorization: `Bearer ${bobToken}` },
      payload: { endpoint },
    })
    expect(bobUnsubscribe.statusCode).toBe(204)
    const gone = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
    expect(gone).toHaveLength(0)
  })

  // ROADMAP.md 2.9's FCM/APNs bullet — no mobile app exists yet to call
  // these for real (Phase 4), but the routes themselves are real and this
  // proves them against a real Postgres, same rigor as the Web Push
  // routes above.
  describe('device tokens', () => {
    it('requires authentication to register or unregister', async () => {
      const register = await app.inject({
        method: 'POST',
        url: '/v1/push/device-tokens',
        payload: { platform: 'fcm', token: 'a-device-token' },
      })
      const unregister = await app.inject({
        method: 'DELETE',
        url: '/v1/push/device-tokens',
        payload: { token: 'a-device-token' },
      })
      expect([register.statusCode, unregister.statusCode]).toEqual([401, 401])
    })

    it('rejects an unrecognized platform', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/push/device-tokens',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: { platform: 'windows-phone', token: 't' },
      })
      expect(response.statusCode).toBe(400)
    })

    it('registers an FCM token, re-registering the same token re-points it, then unregisters', async () => {
      const db = createDatabase(postgresContainer.getConnectionUri())
      const token = 'shared-device-token'

      const aliceRegister = await app.inject({
        method: 'POST',
        url: '/v1/push/device-tokens',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: { platform: 'fcm', token },
      })
      expect(aliceRegister.statusCode).toBe(204)

      let rows = await db.select().from(deviceTokens).where(eq(deviceTokens.token, token))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.platform).toBe('fcm')

      // Same token re-registered under a different account (e.g. alice
      // logged out, bob logged in on the same device) — re-points, not a
      // second row.
      const bobRegister = await app.inject({
        method: 'POST',
        url: '/v1/push/device-tokens',
        headers: { authorization: `Bearer ${bobToken}` },
        payload: { platform: 'fcm', token },
      })
      expect(bobRegister.statusCode).toBe(204)

      rows = await db.select().from(deviceTokens).where(eq(deviceTokens.token, token))
      expect(rows).toHaveLength(1)

      // alice can't unregister a device that's now bob's.
      const aliceUnregister = await app.inject({
        method: 'DELETE',
        url: '/v1/push/device-tokens',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: { token },
      })
      expect(aliceUnregister.statusCode).toBe(204) // succeeds as a request, but...
      const stillThere = await db.select().from(deviceTokens).where(eq(deviceTokens.token, token))
      expect(stillThere).toHaveLength(1) // ...nothing was deleted — it wasn't alice's row.

      const bobUnregister = await app.inject({
        method: 'DELETE',
        url: '/v1/push/device-tokens',
        headers: { authorization: `Bearer ${bobToken}` },
        payload: { token },
      })
      expect(bobUnregister.statusCode).toBe(204)
      const gone = await db.select().from(deviceTokens).where(eq(deviceTokens.token, token))
      expect(gone).toHaveLength(0)
    })

    it('registers an APNs token independently of an FCM one for the same user', async () => {
      const db = createDatabase(postgresContainer.getConnectionUri())

      await app.inject({
        method: 'POST',
        url: '/v1/push/device-tokens',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: { platform: 'fcm', token: 'alice-android' },
      })
      await app.inject({
        method: 'POST',
        url: '/v1/push/device-tokens',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: { platform: 'apns', token: 'alice-iphone' },
      })

      const rows = await db
        .select()
        .from(deviceTokens)
        .where(eq(deviceTokens.token, 'alice-iphone'))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.platform).toBe('apns')
    })
  })
})
