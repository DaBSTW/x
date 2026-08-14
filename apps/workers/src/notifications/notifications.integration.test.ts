import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import {
  type Database,
  blocks,
  createDatabase,
  deviceTokens,
  migrationsFolderUrl,
  mutes,
  notificationPreferences,
  notifications,
  pushSubscriptions,
  userCounters,
  users,
} from '@x/db'
import {
  INTERACTION_EVENTS_TOPIC,
  type NotificationJobData,
  generateId,
  unreadCountKey,
} from '@x/utils'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { Redis } from 'ioredis'
import { Kafka, type Producer, logLevel } from 'kafkajs'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createNotificationsRepository } from './notifications.repository.js'
import { createNotificationsWorker } from './notifications.worker.js'

// Same fixed external port / Redpanda-not-Confluent / real-healthcheck
// reasoning as fanout.integration.test.ts's own createRedpandaContainer —
// duplicated rather than shared (CODESTYLE.md §7 covers apps/*, not test
// helpers within one). A distinct port from search-indexer's (29192),
// fanout's (29193), and register-cdc-connector's (29292) so all four could
// run concurrently without colliding.
const REDPANDA_EXTERNAL_PORT = 29194

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

/** Same reasoning as fanout.integration.test.ts's own waitFor — Kafka delivery here is genuinely asynchronous, so a single assertion right after producing would be racy by construction. */
async function waitFor<T>(check: () => Promise<T | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await check()
    if (result !== false) return result
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`waitFor: condition never became true within ${timeoutMs}ms`)
}

/** Publishes one interaction.events message in the same shape app.ts's own publishNotification wrapper produces — including the eventId, required by notifications.worker.ts's parseInteractionEvent and used as this topic's idempotency key. */
async function produceInteractionEvent(
  producer: Producer,
  data: NotificationJobData,
): Promise<void> {
  await producer.send({
    topic: INTERACTION_EVENTS_TOPIC,
    messages: [
      {
        key: data.userId,
        value: JSON.stringify({ ...data, eventId: generateId().toString() }),
      },
    ],
  })
}

describe('notifications worker', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let redpandaContainer: StartedTestContainer
  let db: Database
  let redis: Redis
  let kafkaBrokers: string[]
  let dlqProducer: Producer

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
    ;[postgresContainer, redisContainer, redpandaContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      createRedpandaContainer().start(),
    ])
    db = createDatabase(postgresContainer.getConnectionUri())
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })
    redis = new Redis(redisContainer.getConnectionUrl())
    kafkaBrokers = [`localhost:${REDPANDA_EXTERNAL_PORT}`]
    dlqProducer = new Kafka({
      clientId: 'notifications-test-dlq',
      brokers: kafkaBrokers,
      logLevel: logLevel.ERROR,
    }).producer({ idempotent: true })
    await dlqProducer.connect()
  }, 120_000)

  afterAll(async () => {
    redis.disconnect()
    await dlqProducer.disconnect()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), redpandaContainer.stop()])
  })

  it('processes a produced Kafka message end-to-end: inserts the row and updates a warm counter', async () => {
    const recipient = await insertUser('rcpt')
    const actor = await insertUser('actr')

    // Pre-warm the counter, same as apps/api's getUnreadCount would after a
    // cold read — proves the worker bumps an existing cache instead of
    // ignoring it.
    await redis.set(unreadCountKey(recipient), 0)

    const kafka = new Kafka({
      clientId: 'notifications-test-consumer',
      brokers: kafkaBrokers,
      logLevel: logLevel.ERROR,
    })
    const workerRedis = new Redis(redisContainer.getConnectionUrl())
    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      kafka,
      producer: dlqProducer,
      redis: workerRedis,
      concurrency: 1,
      groupId: `notifications-test-${generateId()}`,
    })
    await handle.start()

    const producer = kafka.producer({ idempotent: true })
    await producer.connect()
    try {
      await produceInteractionEvent(producer, {
        userId: recipient.toString(),
        kind: 'follow',
        actorId: actor.toString(),
        postId: null,
        groupKey: 'follow',
      })

      // The counter bump is the last state change this test cares about —
      // insertFromJob's row write always happens first, in the same
      // handler invocation (notifications.processor.ts). Waiting on the
      // bump directly, instead of on the row and assuming the rest already
      // caught up, needs no timing assumption at all.
      const counter = await waitFor(async () => {
        const value = await redis.get(unreadCountKey(recipient))
        return value === '1' ? value : false
      })
      expect(counter).toBe('1')

      const rows = await db.select().from(notifications).where(eq(notifications.userId, recipient))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ kind: 'follow', actorId: actor, groupKey: 'follow' })
    } finally {
      await producer.disconnect()
      await handle.close()
      workerRedis.disconnect()
    }
  }, 30_000)

  it('leaves a cold counter alone — the next read recomputes it from Postgres', async () => {
    const recipient = await insertUser('rcpt')
    const actor = await insertUser('actr')

    const kafka = new Kafka({
      clientId: 'notifications-test-consumer',
      brokers: kafkaBrokers,
      logLevel: logLevel.ERROR,
    })
    const workerRedis = new Redis(redisContainer.getConnectionUrl())
    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      kafka,
      producer: dlqProducer,
      redis: workerRedis,
      concurrency: 1,
      groupId: `notifications-test-${generateId()}`,
    })
    await handle.start()

    const producer = kafka.producer({ idempotent: true })
    await producer.connect()
    try {
      await produceInteractionEvent(producer, {
        userId: recipient.toString(),
        kind: 'like',
        actorId: actor.toString(),
        postId: '1',
        groupKey: 'like:1',
      })

      const rows = await waitFor(async () => {
        const current = await db
          .select()
          .from(notifications)
          .where(eq(notifications.userId, recipient))
        return current.length > 0 ? current : false
      })
      expect(rows).toHaveLength(1)
      // Nothing in this flow ever sets the key when it started absent —
      // safe to check immediately once the row (the only other state this
      // handler touches before the redis.exists check) is visible.
      expect(await redis.exists(unreadCountKey(recipient))).toBe(0)
    } finally {
      await producer.disconnect()
      await handle.close()
      workerRedis.disconnect()
    }
  }, 30_000)

  it('suppresses a notification across an active block, in either direction, without touching the counter', async () => {
    const recipient = await insertUser('rcpt')
    const actor = await insertUser('actr')
    const canaryActor = await insertUser('cnry')
    await db.insert(blocks).values({ blockerId: actor, blockedId: recipient })
    await redis.set(unreadCountKey(recipient), 0)

    const kafka = new Kafka({
      clientId: 'notifications-test-consumer',
      brokers: kafkaBrokers,
      logLevel: logLevel.ERROR,
    })
    const workerRedis = new Redis(redisContainer.getConnectionUrl())
    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      kafka,
      producer: dlqProducer,
      redis: workerRedis,
      concurrency: 1,
      groupId: `notifications-test-${generateId()}`,
    })
    await handle.start()

    const producer = kafka.producer({ idempotent: true })
    await producer.connect()
    try {
      await produceInteractionEvent(producer, {
        userId: recipient.toString(),
        kind: 'follow',
        actorId: actor.toString(),
        postId: null,
        groupKey: 'follow',
      })

      // insertFromJob returns null for a suppressed job — nothing is ever
      // written anywhere, so there's no effect of *this* message to poll
      // for. A second, unrelated (unblocked) actor's event to the same
      // recipient — same partition key, so Kafka preserves order and this
      // single-partition consumer handles it strictly after the first —
      // gives a real signal to wait on instead: once it's visible, the
      // suppressed message has already been fully handled too.
      await produceInteractionEvent(producer, {
        userId: recipient.toString(),
        kind: 'follow',
        actorId: canaryActor.toString(),
        postId: null,
        groupKey: `follow:${canaryActor.toString()}`,
      })

      const rows = await waitFor(async () => {
        const current = await db
          .select()
          .from(notifications)
          .where(eq(notifications.userId, recipient))
        return current.length > 0 ? current : false
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ actorId: canaryActor })
      // Bumped exactly once — by the canary. If the blocked actor's event
      // had contributed anything at all, this would be '2'.
      expect(await redis.get(unreadCountKey(recipient))).toBe('1')
    } finally {
      await producer.disconnect()
      await handle.close()
      workerRedis.disconnect()
    }
  }, 30_000)

  it('suppresses a notification the recipient muted the actor for', async () => {
    const recipient = await insertUser('rcpt')
    const actor = await insertUser('actr')
    const canaryActor = await insertUser('cnry')
    await db.insert(mutes).values({ muterId: recipient, mutedId: actor })

    const kafka = new Kafka({
      clientId: 'notifications-test-consumer',
      brokers: kafkaBrokers,
      logLevel: logLevel.ERROR,
    })
    const workerRedis = new Redis(redisContainer.getConnectionUrl())
    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      kafka,
      producer: dlqProducer,
      redis: workerRedis,
      concurrency: 1,
      groupId: `notifications-test-${generateId()}`,
    })
    await handle.start()

    const producer = kafka.producer({ idempotent: true })
    await producer.connect()
    try {
      await produceInteractionEvent(producer, {
        userId: recipient.toString(),
        kind: 'like',
        actorId: actor.toString(),
        postId: '1',
        groupKey: 'like:1',
      })
      // Same canary reasoning as the block-suppression test above.
      await produceInteractionEvent(producer, {
        userId: recipient.toString(),
        kind: 'like',
        actorId: canaryActor.toString(),
        postId: '2',
        groupKey: 'like:2',
      })

      const rows = await waitFor(async () => {
        const current = await db
          .select()
          .from(notifications)
          .where(eq(notifications.userId, recipient))
        return current.length > 0 ? current : false
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ actorId: canaryActor, groupKey: 'like:2' })
    } finally {
      await producer.disconnect()
      await handle.close()
      workerRedis.disconnect()
    }
  }, 30_000)

  it('suppresses a notification the recipient turned in_app off for, without touching the counter (ROADMAP.md 2.9)', async () => {
    const recipient = await insertUser('rcpt')
    const actor = await insertUser('actr')
    await db
      .insert(notificationPreferences)
      .values({ userId: recipient, kind: 'like', channel: 'in_app', enabled: false })
    await redis.set(unreadCountKey(recipient), 0)

    const kafka = new Kafka({
      clientId: 'notifications-test-consumer',
      brokers: kafkaBrokers,
      logLevel: logLevel.ERROR,
    })
    const workerRedis = new Redis(redisContainer.getConnectionUrl())
    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      kafka,
      producer: dlqProducer,
      redis: workerRedis,
      concurrency: 1,
      groupId: `notifications-test-${generateId()}`,
    })
    await handle.start()

    const producer = kafka.producer({ idempotent: true })
    await producer.connect()
    try {
      await produceInteractionEvent(producer, {
        userId: recipient.toString(),
        kind: 'like',
        actorId: actor.toString(),
        postId: '1',
        groupKey: 'like:1',
      })
      // The suppressed preference here is scoped to `like` specifically
      // (isChannelEnabled checks kind+channel together) — unlike the
      // block/mute tests above, this canary only needs a different *kind*,
      // not a different actor, to be unaffected by it.
      await produceInteractionEvent(producer, {
        userId: recipient.toString(),
        kind: 'follow',
        actorId: actor.toString(),
        postId: null,
        groupKey: 'follow',
      })

      const rows = await waitFor(async () => {
        const current = await db
          .select()
          .from(notifications)
          .where(eq(notifications.userId, recipient))
        return current.length > 0 ? current : false
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ kind: 'follow' })
      // Bumped exactly once — by the canary follow, not the suppressed like.
      expect(await redis.get(unreadCountKey(recipient))).toBe('1')
    } finally {
      await producer.disconnect()
      await handle.close()
      workerRedis.disconnect()
    }
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
    const kafka = new Kafka({
      clientId: 'notifications-test-consumer',
      brokers: kafkaBrokers,
      logLevel: logLevel.ERROR,
    })
    const workerRedis = new Redis(redisContainer.getConnectionUrl())
    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      kafka,
      producer: dlqProducer,
      redis: workerRedis,
      concurrency: 1,
      groupId: `notifications-test-${generateId()}`,
      sendPush: async (subscription) => {
        sent.push(subscription.endpoint)
        return { expired: subscription.endpoint.endsWith('/stale') }
      },
    })
    await handle.start()

    const producer = kafka.producer({ idempotent: true })
    await producer.connect()
    try {
      // 'follow' is push-enabled by default (@x/utils' defaultChannelEnabled) — no preference row needed.
      await produceInteractionEvent(producer, {
        userId: recipient.toString(),
        kind: 'follow',
        actorId: actor.toString(),
        postId: null,
        groupKey: 'follow',
      })

      // Push-sending (and the expired-subscription cleanup that follows
      // it) is the last thing this handler does, strictly after the row
      // insert and counter bump — waiting on its own final state directly,
      // rather than on the row and assuming push-sending already caught
      // up, needs no timing assumption.
      const remaining = await waitFor(async () => {
        const current = await db
          .select({ endpoint: pushSubscriptions.endpoint })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, recipient))
        return current.length === 1 ? current : false
      })

      expect(sent.sort()).toEqual([
        'https://push.example.com/fresh',
        'https://push.example.com/stale',
      ])
      expect(remaining).toEqual([{ endpoint: 'https://push.example.com/fresh' }])
    } finally {
      await producer.disconnect()
      await handle.close()
      workerRedis.disconnect()
    }
  }, 30_000)

  it('pushes to a real FCM/APNs device token for a push-enabled kind, and cleans up an expired one (ROADMAP.md 2.9)', async () => {
    const recipient = await insertUser('rcpt')
    const actor = await insertUser('actr')
    await db.insert(deviceTokens).values([
      { id: generateId(), userId: recipient, platform: 'fcm', token: 'fcm-fresh' },
      { id: generateId(), userId: recipient, platform: 'fcm', token: 'fcm-stale' },
      { id: generateId(), userId: recipient, platform: 'apns', token: 'apns-fresh' },
    ])

    // Fake transports — same reasoning as the Web Push test above: no real
    // Firebase project or Apple provider exists in this environment, so
    // this proves the worker's own decision-making (lookup across both
    // platforms, per-token dispatch, expired-token cleanup) against real
    // Postgres, not a real FCM/APNs round trip.
    const fcmSent: string[] = []
    const apnsSent: string[] = []
    const kafka = new Kafka({
      clientId: 'notifications-test-consumer',
      brokers: kafkaBrokers,
      logLevel: logLevel.ERROR,
    })
    const workerRedis = new Redis(redisContainer.getConnectionUrl())
    const handle = createNotificationsWorker({
      repository: createNotificationsRepository(db),
      kafka,
      producer: dlqProducer,
      redis: workerRedis,
      concurrency: 1,
      groupId: `notifications-test-${generateId()}`,
      sendFcmPush: async (token) => {
        fcmSent.push(token)
        return { expired: token === 'fcm-stale' }
      },
      sendApnsPush: async (token) => {
        apnsSent.push(token)
        return { expired: false }
      },
    })
    await handle.start()

    const producer = kafka.producer({ idempotent: true })
    await producer.connect()
    try {
      await produceInteractionEvent(producer, {
        userId: recipient.toString(),
        kind: 'follow',
        actorId: actor.toString(),
        postId: null,
        groupKey: 'follow',
      })

      const remaining = await waitFor(async () => {
        const current = await db
          .select({ token: deviceTokens.token })
          .from(deviceTokens)
          .where(eq(deviceTokens.userId, recipient))
        return current.length === 2 ? current : false
      })

      expect(fcmSent.sort()).toEqual(['fcm-fresh', 'fcm-stale'])
      expect(apnsSent).toEqual(['apns-fresh'])
      expect(remaining.map((row) => row.token).sort()).toEqual(['apns-fresh', 'fcm-fresh'])
    } finally {
      await producer.disconnect()
      await handle.close()
      workerRedis.disconnect()
    }
  }, 30_000)
})
