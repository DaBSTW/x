import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, migrationsFolderUrl } from '@x/db'
import { conversationChannel, realtimeStreamKey } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

describe('conversations routes', () => {
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
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), mailpitContainer.stop()])
  })

  it('creates a 1:1 conversation, reuses it, sends/lists/reads messages, and 404s a non-member', async () => {
    const alice = await registerAndLogin('dmalice')
    const bob = await registerAndLogin('dmbob')
    const stranger = await registerAndLogin('dmstranger')

    const created = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { memberIds: [bob.userId], isGroup: false },
    })
    expect(created.statusCode).toBe(201)
    const conversation = created.json().data
    expect(conversation.members.map((m: { username: string }) => m.username).sort()).toEqual([
      'dmalice',
      'dmbob',
    ])

    const reused = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { memberIds: [alice.userId], isGroup: false },
    })
    expect(reused.json().data.id).toBe(conversation.id)

    const sent = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversation.id}/messages`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { text: 'hola bob' },
    })
    expect(sent.statusCode).toBe(201)
    const message = sent.json().data

    const messages = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversation.id}/messages`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
    })
    expect(messages.json().data.map((m: { text: string }) => m.text)).toEqual(['hola bob'])

    const listBeforeRead = await app.inject({
      method: 'GET',
      url: '/v1/conversations',
      headers: { authorization: `Bearer ${bob.accessToken}` },
    })
    expect(listBeforeRead.json().data[0].unreadCount).toBe(1)

    const read = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversation.id}/read`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { messageId: message.id },
    })
    expect(read.statusCode).toBe(204)

    const listAfterRead = await app.inject({
      method: 'GET',
      url: '/v1/conversations',
      headers: { authorization: `Bearer ${bob.accessToken}` },
    })
    expect(listAfterRead.json().data[0].unreadCount).toBe(0)

    const strangerRead = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversation.id}/messages`,
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })
    expect(strangerRead.statusCode).toBe(404)

    const strangerSend = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversation.id}/messages`,
      headers: { authorization: `Bearer ${stranger.accessToken}` },
      payload: { text: 'colándome' },
    })
    expect(strangerSend.statusCode).toBe(404)
  })

  it('creates a group conversation with every named member', async () => {
    const alice = await registerAndLogin('dmgalice')
    const bob = await registerAndLogin('dmgbob')
    const carol = await registerAndLogin('dmgcarol')

    const created = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { memberIds: [bob.userId, carol.userId], isGroup: true, name: 'Equipo' },
    })

    expect(created.statusCode).toBe(201)
    const conversation = created.json().data
    expect(conversation.isGroup).toBe(true)
    expect(conversation.name).toBe('Equipo')
    expect(conversation.members).toHaveLength(3)
  })

  it('rejects a 1:1 with a "following"-only account until it follows back (ROADMAP.md 2.5)', async () => {
    const alice = await registerAndLogin('dmpalice')
    const bob = await registerAndLogin('dmpbob')

    const setPrivacy = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { dmPrivacy: 'following' },
    })
    expect(setPrivacy.statusCode).toBe(200)

    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { memberIds: [bob.userId], isGroup: false },
    })
    expect(rejected.statusCode).toBe(403)

    const follow = await app.inject({
      method: 'POST',
      url: `/v1/users/${alice.userId}/follow`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
    })
    expect(follow.statusCode).toBe(200)

    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { memberIds: [bob.userId], isGroup: false },
    })
    expect(allowed.statusCode).toBe(201)
  })

  it('publishes a real message.created event to the conversation channel, durably (ROADMAP.md 2.5/2.2)', async () => {
    const alice = await registerAndLogin('dmrtalice')
    const bob = await registerAndLogin('dmrtbob')

    const created = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { memberIds: [bob.userId], isGroup: false },
    })
    const conversationId = created.json().data.id as string

    const sent = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { text: 'evento en vivo' },
    })
    const message = sent.json().data

    // The durable half (XADD) — what a reconnecting client's `since`
    // replays from (ROADMAP.md 2.2) — checked directly against the real
    // Redis Stream, not just that the HTTP call itself returned 201.
    const channel = conversationChannel(conversationId)
    const entries = await app.redis.xrange(realtimeStreamKey(channel), '-', '+')
    expect(entries).toHaveLength(1)
    const fields = entries[0]?.[1] ?? []
    const fieldMap = Object.fromEntries(
      Array.from({ length: fields.length / 2 }, (_, i) => [fields[i * 2], fields[i * 2 + 1]]),
    )
    expect(fieldMap.event).toBe('message.created')
    expect(JSON.parse(fieldMap.data ?? '{}')).toMatchObject({
      id: message.id,
      conversationId,
      senderId: alice.userId,
      text: 'evento en vivo',
    })
  })
})
