import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import {
  type Database,
  blocks,
  createDatabase,
  migrationsFolderUrl,
  mutes,
  notificationPreferences,
  notifications,
  pushSubscriptions,
  userCounters,
  users,
} from '@x/db'
import {
  NOTIFICATIONS_QUEUE_NAME,
  type NotificationJobData,
  generateId,
  unreadCountKey,
} from '@x/utils'
import { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createNotificationsRepository } from './notifications.repository.js'
import { createNotificationsWorker } from './notifications.worker.js'

describe('notifications worker', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let redisUrl: string
  let db: Database
  let redis: Redis

  async function insertUser(prefix: string): Promise<bigint> {
    const id = generateId()
    const username = `${prefix}${id.toString().slice(-10)}`
    await db.insert(users).values({
      id,
      username,
      usernameLower: username.toLowerCase(),
      email: `${username}@example.com`,
      displayName: username,
    })
    await db.insert(userCounters).values({ userId: id })
    return id
  }

  beforeAll(async () => {
    ;[postgresContainer, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ])
    db = createDatabase(postgresContainer.getConnectionUri())
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })
    redisUrl = redisContainer.getConnectionUrl()
    redis = new Redis(redisUrl)
  }, 120_000)

  afterAll(async () => {
    redis.disconnect()
    await Promise.all([postgresContainer.stop(), redisContainer.stop()])
  })

  it('processes a queued job end-to-end: inserts the row and updates a warm counter', async () => {
    const recipient = await insertUser('rcpt')
    const actor = await insertUser('actr')

    // Pre-warm the counter, same as apps/api's getUnreadCount would after a
    // cold read — proves the worker bumps an existing cache instead of
    // ignoring it.
    await redis.set(unreadCountKey(recipient), 0)

    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      redisUrl,
      concurrency: 1,
    })
    const queue = new Queue<NotificationJobData>(NOTIFICATIONS_QUEUE_NAME, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })

    const completed = new Promise<void>((resolve, reject) => {
      handle.worker.on('completed', () => resolve())
      handle.worker.on('failed', (_job, error) => reject(error))
    })
    await queue.add('notify', {
      userId: recipient.toString(),
      kind: 'follow',
      actorId: actor.toString(),
      postId: null,
      groupKey: 'follow',
    })
    await completed

    const rows = await db.select().from(notifications).where(eq(notifications.userId, recipient))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'follow', actorId: actor, groupKey: 'follow' })

    expect(await redis.get(unreadCountKey(recipient))).toBe('1')

    await queue.close()
    await handle.close()
  }, 30_000)

  it('leaves a cold counter alone — the next read recomputes it from Postgres', async () => {
    const recipient = await insertUser('rcpt')
    const actor = await insertUser('actr')

    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      redisUrl,
      concurrency: 1,
    })
    const queue = new Queue<NotificationJobData>(NOTIFICATIONS_QUEUE_NAME, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })

    const completed = new Promise<void>((resolve, reject) => {
      handle.worker.on('completed', () => resolve())
      handle.worker.on('failed', (_job, error) => reject(error))
    })
    await queue.add('notify', {
      userId: recipient.toString(),
      kind: 'like',
      actorId: actor.toString(),
      postId: '1',
      groupKey: 'like:1',
    })
    await completed

    expect(await redis.exists(unreadCountKey(recipient))).toBe(0)
    const rows = await db.select().from(notifications).where(eq(notifications.userId, recipient))
    expect(rows).toHaveLength(1)

    await queue.close()
    await handle.close()
  }, 30_000)

  it('suppresses a notification across an active block, in either direction, without touching the counter', async () => {
    const recipient = await insertUser('rcpt')
    const actor = await insertUser('actr')
    await db.insert(blocks).values({ blockerId: actor, blockedId: recipient })
    await redis.set(unreadCountKey(recipient), 0)

    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      redisUrl,
      concurrency: 1,
    })
    const queue = new Queue<NotificationJobData>(NOTIFICATIONS_QUEUE_NAME, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })

    const completed = new Promise<void>((resolve, reject) => {
      handle.worker.on('completed', () => resolve())
      handle.worker.on('failed', (_job, error) => reject(error))
    })
    await queue.add('notify', {
      userId: recipient.toString(),
      kind: 'follow',
      actorId: actor.toString(),
      postId: null,
      groupKey: 'follow',
    })
    await completed

    const rows = await db.select().from(notifications).where(eq(notifications.userId, recipient))
    expect(rows).toHaveLength(0)
    expect(await redis.get(unreadCountKey(recipient))).toBe('0')

    await queue.close()
    await handle.close()
  }, 30_000)

  it('suppresses a notification the recipient muted the actor for', async () => {
    const recipient = await insertUser('rcpt')
    const actor = await insertUser('actr')
    await db.insert(mutes).values({ muterId: recipient, mutedId: actor })

    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      redisUrl,
      concurrency: 1,
    })
    const queue = new Queue<NotificationJobData>(NOTIFICATIONS_QUEUE_NAME, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })

    const completed = new Promise<void>((resolve, reject) => {
      handle.worker.on('completed', () => resolve())
      handle.worker.on('failed', (_job, error) => reject(error))
    })
    await queue.add('notify', {
      userId: recipient.toString(),
      kind: 'like',
      actorId: actor.toString(),
      postId: '1',
      groupKey: 'like:1',
    })
    await completed

    const rows = await db.select().from(notifications).where(eq(notifications.userId, recipient))
    expect(rows).toHaveLength(0)

    await queue.close()
    await handle.close()
  }, 30_000)

  it('suppresses a notification the recipient turned in_app off for, without touching the counter (ROADMAP.md 2.9)', async () => {
    const recipient = await insertUser('rcpt')
    const actor = await insertUser('actr')
    await db
      .insert(notificationPreferences)
      .values({ userId: recipient, kind: 'like', channel: 'in_app', enabled: false })
    await redis.set(unreadCountKey(recipient), 0)

    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      redisUrl,
      concurrency: 1,
    })
    const queue = new Queue<NotificationJobData>(NOTIFICATIONS_QUEUE_NAME, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })

    const completed = new Promise<void>((resolve, reject) => {
      handle.worker.on('completed', () => resolve())
      handle.worker.on('failed', (_job, error) => reject(error))
    })
    await queue.add('notify', {
      userId: recipient.toString(),
      kind: 'like',
      actorId: actor.toString(),
      postId: '1',
      groupKey: 'like:1',
    })
    await completed

    const rows = await db.select().from(notifications).where(eq(notifications.userId, recipient))
    expect(rows).toHaveLength(0)
    expect(await redis.get(unreadCountKey(recipient))).toBe('0')

    await queue.close()
    await handle.close()
  }, 30_000)

  it('pushes to a real subscribed device for a push-enabled kind, and cleans up an expired one (ROADMAP.md 2.9)', async () => {
    const recipient = await insertUser('rcpt')
    const actor = await insertUser('actr')
    await db.insert(pushSubscriptions).values([
      {
        id: generateId(),
        userId: recipient,
        endpoint: 'https://push.example.com/fresh',
        p256dh: 'p256dh-fresh',
        authKey: 'auth-fresh',
      },
      {
        id: generateId(),
        userId: recipient,
        endpoint: 'https://push.example.com/stale',
        p256dh: 'p256dh-stale',
        authKey: 'auth-stale',
      },
    ])

    // A fake transport — the real `web-push` HTTP/encryption round trip is
    // covered by nothing here on purpose (there's no local stand-in for a
    // real browser push service, unlike Mailpit for SMTP); this proves the
    // worker's own decision-making (preference check, subscription lookup,
    // expired-subscription cleanup) against real Postgres instead.
    const sent: string[] = []
    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      redisUrl,
      concurrency: 1,
      sendPush: async (subscription) => {
        sent.push(subscription.endpoint)
        return { expired: subscription.endpoint.endsWith('/stale') }
      },
    })
    const queue = new Queue<NotificationJobData>(NOTIFICATIONS_QUEUE_NAME, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })

    const completed = new Promise<void>((resolve, reject) => {
      handle.worker.on('completed', () => resolve())
      handle.worker.on('failed', (_job, error) => reject(error))
    })
    // 'follow' is push-enabled by default (@x/utils' defaultChannelEnabled) — no preference row needed.
    await queue.add('notify', {
      userId: recipient.toString(),
      kind: 'follow',
      actorId: actor.toString(),
      postId: null,
      groupKey: 'follow',
    })
    await completed

    expect(sent.sort()).toEqual([
      'https://push.example.com/fresh',
      'https://push.example.com/stale',
    ])

    const remaining = await db
      .select({ endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, recipient))
    expect(remaining).toEqual([{ endpoint: 'https://push.example.com/fresh' }])

    await queue.close()
    await handle.close()
  }, 30_000)
})
