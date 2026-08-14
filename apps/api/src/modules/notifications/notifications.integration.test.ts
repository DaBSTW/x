import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, migrationsFolderUrl, notifications } from '@x/db'
import { INTERACTION_EVENTS_TOPIC, generateId } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { Kafka, logLevel } from 'kafkajs'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

// Same fixed external port / Redpanda-not-Confluent / real-healthcheck
// reasoning as apps/workers/src/fanout/fanout.integration.test.ts's own
// createRedpandaContainer — duplicated rather than shared (CODESTYLE.md §7
// covers apps/*, not test helpers within one). A distinct port from every
// other file's fixed Redpanda port (search-indexer's 29192, fanout's
// 29193, notifications worker's 29194, register-cdc-connector's 29292) so
// all could run concurrently without colliding.
const REDPANDA_EXTERNAL_PORT = 29195

function createRedpandaContainer(): GenericContainer {
  return new GenericContainer('redpandadata/redpanda:latest')
    .withExposedPorts({ container: REDPANDA_EXTERNAL_PORT, host: REDPANDA_EXTERNAL_PORT })
    .withCommand([
      'redpanda',
      'start',
      '--smp',
      '1',
      '--memory',
      '512M',
      '--overprovisioned',
      '--node-id',
      '0',
      '--check=false',
      '--kafka-addr',
      `PLAINTEXT://0.0.0.0:${REDPANDA_EXTERNAL_PORT}`,
      '--advertise-kafka-addr',
      `PLAINTEXT://localhost:${REDPANDA_EXTERNAL_PORT}`,
    ])
    .withWaitStrategy(Wait.forSuccessfulCommand('rpk cluster health | grep -q "Healthy:.*true"'))
    .withStartupTimeout(120_000)
}

/** Same reasoning as fanout.integration.test.ts's own waitFor — a separate observing consumer catching up to a real produce is genuinely asynchronous, so a single assertion right after the request returns would be racy by construction. */
async function waitFor<T>(check: () => Promise<T | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await check()
    if (result !== false) return result
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`waitFor: condition never became true within ${timeoutMs}ms`)
}

describe('notifications routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let redpandaContainer: StartedTestContainer
  let app: FastifyInstance
  let kafkaBrokers: string[]
  let aliceToken: string
  let aliceId: string
  let bobId: string
  let bobToken: string

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
    return { accessToken: loginResponse.json().data.accessToken as string, userId }
  }

  beforeAll(async () => {
    ;[postgresContainer, redisContainer, mailpitContainer, redpandaContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      new GenericContainer('axllent/mailpit:latest')
        .withExposedPorts(1025, 8025)
        .withWaitStrategy(Wait.forListeningPorts())
        .start(),
      createRedpandaContainer().start(),
    ])
    kafkaBrokers = [`localhost:${REDPANDA_EXTERNAL_PORT}`]

    const migrationDb = createDatabase(postgresContainer.getConnectionUri())
    await migrate(migrationDb, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    const env: Env = {
      NODE_ENV: 'test',
      API_PORT: 0,
      WEB_URL: 'http://localhost:3000',
      CORS_ORIGIN: 'http://localhost:3000',
      WORKER_ID: 7,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      // A real broker this time (unlike every other file's placeholder) —
      // the "produces a real Kafka interaction.events message" test below
      // asserts on the actual produced message, not just that the request
      // itself succeeds.
      KAFKA_BROKERS: kafkaBrokers.join(','),
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
    }
    app = await buildApp(env)

    const alice = await registerAndLogin('alice')
    aliceToken = alice.accessToken
    aliceId = alice.userId
    const bob = await registerAndLogin('bob')
    bobId = bob.userId
    bobToken = bob.accessToken
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([
      postgresContainer.stop(),
      redisContainer.stop(),
      mailpitContainer.stop(),
      redpandaContainer.stop(),
    ])
  })

  it('requires authentication on every route', async () => {
    const list = await app.inject({ method: 'GET', url: '/v1/notifications' })
    const unread = await app.inject({ method: 'GET', url: '/v1/notifications/unread-count' })
    const read = await app.inject({
      method: 'POST',
      url: '/v1/notifications/read',
      payload: { cursor: '1' },
    })
    const getPreferences = await app.inject({
      method: 'GET',
      url: '/v1/notifications/preferences',
    })
    const putPreference = await app.inject({
      method: 'PUT',
      url: '/v1/notifications/preferences',
      payload: { kind: 'like', channel: 'push', enabled: true },
    })
    expect([
      list.statusCode,
      unread.statusCode,
      read.statusCode,
      getPreferences.statusCode,
      putPreference.statusCode,
    ]).toEqual([401, 401, 401, 401, 401])
  })

  it('lists, counts, and marks notifications read for a real recipient', async () => {
    // No worker runs in this test process — insert directly, same
    // rationale as timeline.integration.test.ts's manual ZADD for the
    // "warm" path: the queue/consumer path is covered by
    // apps/workers/src/notifications/notifications.integration.test.ts.
    const db = createDatabase(postgresContainer.getConnectionUri())
    // generateId() is monotonically increasing within a process — no need
    // to sort, oldestId < middleId < newestId by construction.
    const oldestId = generateId()
    const middleId = generateId()
    const newestId = generateId()
    await db.insert(notifications).values([
      {
        id: oldestId,
        userId: BigInt(aliceId),
        kind: 'follow',
        actorId: BigInt(bobId),
        groupKey: 'follow',
      },
      {
        id: middleId,
        userId: BigInt(aliceId),
        kind: 'follow',
        actorId: BigInt(bobId),
        groupKey: 'follow',
      },
      { id: newestId, userId: BigInt(aliceId), kind: 'system', actorId: null },
    ])

    const unreadBefore = await app.inject({
      method: 'GET',
      url: '/v1/notifications/unread-count',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(unreadBefore.json().data.count).toBe(3)

    const list = await app.inject({
      method: 'GET',
      url: '/v1/notifications?limit=2',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(list.statusCode).toBe(200)
    const body = list.json()
    expect(body.data).toHaveLength(2)
    expect(body.data[0].id).toBe(newestId.toString())
    expect(body.meta.hasMore).toBe(true)

    const markRead = await app.inject({
      method: 'POST',
      url: '/v1/notifications/read',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { cursor: middleId.toString() },
    })
    expect(markRead.statusCode).toBe(204)

    const unreadAfter = await app.inject({
      method: 'GET',
      url: '/v1/notifications/unread-count',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(unreadAfter.json().data.count).toBe(1) // only newestId (system) is still unread
  })

  it("doesn't leak another user's notifications", async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: { authorization: `Bearer ${bobToken}` },
    })
    expect(response.json().data).toEqual([])
  })

  it('produces a real Kafka interaction.events message when bob follows alice (ROADMAP.md 3.1)', async () => {
    const kafka = new Kafka({
      clientId: 'notifications-route-test',
      brokers: kafkaBrokers,
      logLevel: logLevel.ERROR,
    })
    const consumer = kafka.consumer({ groupId: `notifications-route-test-${generateId()}` })
    await consumer.connect()
    await consumer.subscribe({ topic: INTERACTION_EVENTS_TOPIC, fromBeginning: true })
    const received: unknown[] = []
    const consuming = consumer.run({
      eachMessage: async ({ message }) => {
        if (message.value) received.push(JSON.parse(message.value.toString('utf8')))
      },
    })

    try {
      // social-graph.service.ts's follow() awaits publishNotification
      // (inside a try/catch, but still awaited) before returning —
      // kafkajs's idempotent producer only resolves send() once the broker
      // has acknowledged the write, so by the time this response comes
      // back the message is already durably in Kafka. Only *observing* it
      // here needs a poll (a separate consumer catching up is inherently
      // asynchronous); producing it doesn't.
      const response = await app.inject({
        method: 'POST',
        url: `/v1/users/${aliceId}/follow`,
        headers: { authorization: `Bearer ${bobToken}` },
      })
      expect(response.statusCode).toBe(200)

      const events = await waitFor(async () => (received.length > 0 ? received : false))
      expect(events).toContainEqual(
        expect.objectContaining({ userId: aliceId, kind: 'follow', actorId: bobId }),
      )
    } finally {
      await consumer.disconnect()
      await consuming.catch(() => {})
    }
  })

  it('returns the default preference matrix, then persists an override (ROADMAP.md 2.9)', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/v1/notifications/preferences',
      headers: { authorization: `Bearer ${bobToken}` },
    })
    expect(before.statusCode).toBe(200)
    const beforeData = before.json().data as Array<{
      kind: string
      channel: string
      enabled: boolean
    }>
    expect(beforeData).toHaveLength(14)
    // Default: push is off for "like" until bob turns it on below.
    expect(beforeData.find((p) => p.kind === 'like' && p.channel === 'push')?.enabled).toBe(false)

    const update = await app.inject({
      method: 'PUT',
      url: '/v1/notifications/preferences',
      headers: { authorization: `Bearer ${bobToken}` },
      payload: { kind: 'like', channel: 'push', enabled: true },
    })
    expect(update.statusCode).toBe(204)

    const after = await app.inject({
      method: 'GET',
      url: '/v1/notifications/preferences',
      headers: { authorization: `Bearer ${bobToken}` },
    })
    const afterData = after.json().data as Array<{
      kind: string
      channel: string
      enabled: boolean
    }>
    expect(afterData.find((p) => p.kind === 'like' && p.channel === 'push')?.enabled).toBe(true)
    // Untouched defaults, including alice's (a different user), are unaffected.
    expect(afterData.find((p) => p.kind === 'repost' && p.channel === 'push')?.enabled).toBe(false)

    const aliceStill = await app.inject({
      method: 'GET',
      url: '/v1/notifications/preferences',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(
      (aliceStill.json().data as Array<{ kind: string; channel: string; enabled: boolean }>).find(
        (p) => p.kind === 'like' && p.channel === 'push',
      )?.enabled,
    ).toBe(false)
  })
})
