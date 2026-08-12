import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import {
  type Database,
  conversationMembers,
  conversations,
  createDatabase,
  migrationsFolderUrl,
  users,
} from '@x/db'
import { generateId, generateOpaqueToken, realtimeTicketKey, sha256Hex } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { Redis } from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../app.js'
import type { Env } from '../env.js'

async function insertUser(db: Database, prefix: string): Promise<bigint> {
  const id = generateId()
  // usernames are varchar(15) — a short prefix plus the low digits of the
  // Snowflake id keeps every test user unique without hitting the limit
  // (same helper shape as apps/workers' fanout.integration.test.ts).
  const username = `${prefix}${id.toString().slice(-10)}`
  await db.insert(users).values({
    id,
    username,
    usernameLower: username.toLowerCase(),
    email: `${username}@example.com`,
    displayName: username,
  })
  return id
}

/**
 * Mirrors apps/api's realtime.service.ts exactly — the two apps can't
 * import each other (CODESTYLE.md §7), so this proves the gateway's
 * redemption side against the same key format apps/api's own
 * realtime.integration.test.ts independently proves the issuing side
 * writes to.
 */
async function issueTicket(redis: Redis, userId: bigint): Promise<string> {
  const ticket = generateOpaqueToken()
  await redis.set(realtimeTicketKey(sha256Hex(ticket)), userId.toString(), 'EX', 60)
  return ticket
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
}

/** For a handshake expected to be *rejected* — resolves with the HTTP status instead of opening. */
function waitForRejection(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
    ws.once('open', () => reject(new Error('expected the handshake to be rejected, but it opened')))
  })
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()))
      } catch (error) {
        reject(error)
      }
    })
    ws.once('error', reject)
  })
}

function waitForClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)))
}

/** No message arrives within `withinMs` — the negative-case counterpart to waitForMessage. */
function expectNoMessage(ws: WebSocket, withinMs = 200): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = () => {
      clearTimeout(timer)
      reject(new Error('received a message that should have been suppressed'))
    }
    ws.once('message', onMessage)
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      resolve()
    }, withinMs)
  })
}

describe('ws-gateway', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let db: Database
  let redis: Redis
  let app: FastifyInstance
  let baseUrl: string
  const openSockets: WebSocket[] = []

  beforeAll(async () => {
    ;[postgresContainer, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ])
    db = createDatabase(postgresContainer.getConnectionUri())
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })
    redis = new Redis(redisContainer.getConnectionUrl())

    const env: Env = {
      NODE_ENV: 'test',
      WS_GATEWAY_PORT: 0,
      CORS_ORIGIN: 'http://localhost:3000',
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      // Fast enough that the "closes a silent connection" test doesn't
      // need to wait a real 60s — see env.ts's own comment on why this is
      // configurable at all.
      HEARTBEAT_INTERVAL_MS: 100,
      HEARTBEAT_TIMEOUT_MS: 300,
      BACKPRESSURE_LIMIT_BYTES: 1_048_576,
    }
    app = await buildApp(env)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('expected the test server to bind a TCP address')
    }
    baseUrl = `ws://127.0.0.1:${address.port}/v1`
  }, 120_000)

  afterAll(async () => {
    redis.disconnect()
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop()])
  })

  afterEach(() => {
    for (const socket of openSockets.splice(0)) socket.terminate()
  })

  function connect(query: string, options?: WebSocket.ClientOptions): WebSocket {
    const ws = new WebSocket(`${baseUrl}?${query}`, options)
    // A rejected handshake's own async cleanup (afterEach's .terminate() on
    // a still-CONNECTING socket) can emit a second, later 'error' — Node
    // treats a truly *unlistened* 'error' event as an uncaught exception,
    // so this permanent no-op listener is a safety net. It never masks a
    // real failure: waitForOpen/waitForRejection attach their own 'error'
    // listener too, and EventEmitter fires every listener on an event, not
    // just one.
    ws.on('error', () => {})
    openSockets.push(ws)
    return ws
  }

  it('rejects a connection with no ticket', async () => {
    await expect(waitForRejection(connect(''))).resolves.toBe(401)
  })

  it('rejects a connection with an invalid ticket', async () => {
    await expect(waitForRejection(connect('ticket=not-a-real-ticket'))).resolves.toBe(401)
  })

  it('accepts a connection with a valid ticket, which becomes unusable a second time', async () => {
    const userId = generateId()
    const ticket = await issueTicket(redis, userId)

    const first = connect(`ticket=${ticket}`)
    await waitForOpen(first)
    first.close()
    await waitForClose(first)

    await expect(waitForRejection(connect(`ticket=${ticket}`))).resolves.toBe(401)
  })

  it('rejects a connection whose Origin header does not match the configured one', async () => {
    const userId = generateId()
    const ticket = await issueTicket(redis, userId)
    const ws = connect(`ticket=${ticket}`, { headers: { origin: 'https://evil.example.com' } })
    await expect(waitForRejection(ws)).resolves.toBe(403)
  })

  it('delivers an event published on a channel the connection subscribed to', async () => {
    const userId = generateId()
    const ticket = await issueTicket(redis, userId)
    const ws = connect(`ticket=${ticket}`)
    await waitForOpen(ws)

    ws.send(JSON.stringify({ op: 'subscribe', channels: [`user:${userId}`] }))
    await expect(waitForMessage(ws)).resolves.toEqual({
      op: 'subscribed',
      channels: [`user:${userId}`],
    })

    const nextMessage = waitForMessage(ws)
    const payload = JSON.stringify({
      op: 'event',
      channel: `user:${userId}`,
      event: 'notification.new',
      data: { id: '1' },
      eventId: '1723-0',
    })
    await redis.publish(`user:${userId}`, payload)
    await expect(nextMessage).resolves.toEqual(JSON.parse(payload))
  })

  it("rejects subscribing to someone else's user: channel and never delivers events published there", async () => {
    const userId = generateId()
    const otherUserId = generateId()
    const ticket = await issueTicket(redis, userId)
    const ws = connect(`ticket=${ticket}`)
    await waitForOpen(ws)

    ws.send(JSON.stringify({ op: 'subscribe', channels: [`user:${otherUserId}`] }))
    await expect(waitForMessage(ws)).resolves.toMatchObject({ op: 'error' })

    await redis.publish(`user:${otherUserId}`, JSON.stringify({ op: 'event' }))
    await expectNoMessage(ws)
  })

  it('authorizes a conv: channel only for an actual member', async () => {
    const memberId = await insertUser(db, 'mem')
    const strangerId = await insertUser(db, 'str')
    const conversationId = generateId()
    await db
      .insert(conversations)
      .values({ id: conversationId, isGroup: false, name: null, createdBy: memberId })
    await db.insert(conversationMembers).values({ conversationId, userId: memberId })

    const memberWs = connect(`ticket=${await issueTicket(redis, memberId)}`)
    await waitForOpen(memberWs)
    memberWs.send(JSON.stringify({ op: 'subscribe', channels: [`conv:${conversationId}`] }))
    await expect(waitForMessage(memberWs)).resolves.toEqual({
      op: 'subscribed',
      channels: [`conv:${conversationId}`],
    })

    const strangerWs = connect(`ticket=${await issueTicket(redis, strangerId)}`)
    await waitForOpen(strangerWs)
    strangerWs.send(JSON.stringify({ op: 'subscribe', channels: [`conv:${conversationId}`] }))
    await expect(waitForMessage(strangerWs)).resolves.toMatchObject({ op: 'error' })
  })

  it('stops delivering to a channel once the connection unsubscribes', async () => {
    const userId = generateId()
    const ws = connect(`ticket=${await issueTicket(redis, userId)}`)
    await waitForOpen(ws)

    ws.send(JSON.stringify({ op: 'subscribe', channels: [`timeline:${userId}`] }))
    await waitForMessage(ws) // subscribed ack

    ws.send(JSON.stringify({ op: 'unsubscribe', channels: [`timeline:${userId}`] }))
    await expect(waitForMessage(ws)).resolves.toEqual({
      op: 'unsubscribed',
      channels: [`timeline:${userId}`],
    })

    await redis.publish(`timeline:${userId}`, JSON.stringify({ op: 'event' }))
    await expectNoMessage(ws)
  })

  it('closes a connection that never responds to a ping, within the configured heartbeat timeout', async () => {
    const userId = generateId()
    const ticket = await issueTicket(redis, userId)
    // ws's client auto-responds to a ping with a pong at the protocol level
    // by default — autoPong: false is the supported way to opt out, the
    // only way to exercise the actual timeout path for real instead of
    // only the "healthy connections survive" case the other tests already
    // cover implicitly (every one of them pings-and-survives for the
    // seconds it takes to run).
    const ws = connect(`ticket=${ticket}`, { autoPong: false })
    await waitForOpen(ws)

    const closeCode = await waitForClose(ws)
    // 1006 (abnormal closure) is what a client observes for a server-side
    // .terminate() — no closing handshake, unlike a clean .close().
    expect(closeCode).toBe(1006)
  })
})
