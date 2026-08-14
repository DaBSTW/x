import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import {
  type Database,
  createDatabase,
  follows,
  migrationsFolderUrl,
  userCounters,
  users,
} from '@x/db'
import {
  CELEBRITY_FOLLOWER_THRESHOLD,
  POST_CREATED_TOPIC,
  TIMELINE_RETENTION_SIZE,
  generateId,
  realtimeStreamKey,
  timelineChannel,
  timelineKey,
} from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { Redis } from 'ioredis'
import { Kafka, type Producer, logLevel } from 'kafkajs'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createFanoutProcessor } from './fanout.processor.js'
import { createFanoutRepository } from './fanout.repository.js'
import { createFanoutWorker } from './fanout.worker.js'

// Same fixed external port / Redpanda-not-Confluent / real-healthcheck
// reasoning as search-indexer.worker.integration.test.ts's own
// createRedpandaContainer — duplicated rather than shared (CODESTYLE.md
// §7 covers apps/*, not test helpers within one, but there's still no
// existing "test infra" package this repo shares between spec files
// today, so a small, stable helper like this one is duplicated the same
// way channel-authorization.ts is duplicated between apps/api and
// apps/ws-gateway).
const REDPANDA_EXTERNAL_PORT = 29193

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

/** Same reasoning as search-indexer.worker.integration.test.ts's own waitFor — the produce→consume path here is genuinely asynchronous, so a single assertion right after producing would be racy by construction. */
async function waitFor<T>(check: () => Promise<T | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await check()
    if (result !== false) return result
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`waitFor: condition never became true within ${timeoutMs}ms`)
}

async function insertUser(
  db: Database,
  overrides: { prefix: string; followersCount?: number },
): Promise<bigint> {
  const id = generateId()
  // usernames are varchar(15) — a short prefix plus the low digits of the
  // Snowflake id keeps every test user unique without hitting the limit.
  const username = `${overrides.prefix}${id.toString().slice(-10)}`
  await db.insert(users).values({
    id,
    username,
    usernameLower: username.toLowerCase(),
    email: `${username}@example.com`,
    displayName: username,
  })
  await db
    .insert(userCounters)
    .values({ userId: id, followersCount: overrides.followersCount ?? 0 })
  return id
}

describe('fan-out worker', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let redpandaContainer: StartedTestContainer
  let db: Database
  let redis: Redis
  let kafkaBrokers: string[]
  let dlqProducer: Producer

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
      clientId: 'fanout-test-dlq',
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

  it('pushes a post onto every follower timeline and sets a 7-day TTL', async () => {
    const author = await insertUser(db, { prefix: 'a' })
    const follower = await insertUser(db, { prefix: 'f' })
    await db.insert(follows).values({ followerId: follower, followeeId: author })

    const repository = createFanoutRepository(db)
    const process = createFanoutProcessor({ repository, redis })
    const postId = generateId()

    await process({ postId: postId.toString(), authorId: author.toString() })

    const members = await redis.zrange(timelineKey(follower), 0, -1)
    expect(members).toEqual([postId.toString()])
    const ttl = await redis.ttl(timelineKey(follower))
    expect(ttl).toBeGreaterThan(0)
  })

  it("publishes a post.available event on the follower's timeline channel, over real Redis pub/sub (ROADMAP.md 2.2 badge)", async () => {
    const author = await insertUser(db, { prefix: 'a' })
    const follower = await insertUser(db, { prefix: 'f' })
    await db.insert(follows).values({ followerId: follower, followeeId: author })

    const subscriber = new Redis(redisContainer.getConnectionUrl())
    const received: unknown[] = []
    await subscriber.subscribe(timelineChannel(follower))
    subscriber.on('message', (_channel, message) => received.push(JSON.parse(message)))

    try {
      const repository = createFanoutRepository(db)
      const process = createFanoutProcessor({ repository, redis })
      const postId = generateId()

      await process({ postId: postId.toString(), authorId: author.toString() })
      // PUBLISH fans out synchronously to already-subscribed clients on the
      // same Redis server, but the subscriber's own event loop still needs
      // a tick to deliver it — a short poll instead of a fixed sleep.
      await vi.waitFor(() => expect(received).toHaveLength(1))

      expect(received[0]).toMatchObject({
        op: 'event',
        channel: timelineChannel(follower),
        event: 'post.available',
        data: { postId: postId.toString() },
      })
    } finally {
      subscriber.disconnect()
    }
  })

  it("XADDs the same event to the follower's stream, under the id PUBLISH carried as eventId (ROADMAP.md 2.2 recovery)", async () => {
    const author = await insertUser(db, { prefix: 'a' })
    const follower = await insertUser(db, { prefix: 'f' })
    await db.insert(follows).values({ followerId: follower, followeeId: author })

    const repository = createFanoutRepository(db)
    const process = createFanoutProcessor({ repository, redis })
    const postId = generateId()

    await process({ postId: postId.toString(), authorId: author.toString() })

    const entries = await redis.xrange(realtimeStreamKey(timelineChannel(follower)), '-', '+')
    expect(entries).toHaveLength(1)
    const [entryId, fields] = entries[0] as [string, string[]]
    const dataIndex = fields.indexOf('data')
    expect(dataIndex).toBeGreaterThanOrEqual(0)
    expect(JSON.parse(fields[dataIndex + 1] as string)).toEqual({ postId: postId.toString() })

    // Same identity on both paths — a client that reconnects and replays
    // via XRANGE, and one that received this live over PUBLISH, must agree
    // on what "this event" is called.
    const subscriber = new Redis(redisContainer.getConnectionUrl())
    const received: unknown[] = []
    await subscriber.subscribe(timelineChannel(follower))
    subscriber.on('message', (_channel, message) => received.push(JSON.parse(message)))
    try {
      const secondPostId = generateId()
      await process({ postId: secondPostId.toString(), authorId: author.toString() })
      await vi.waitFor(() => expect(received).toHaveLength(1))
      const secondEntries = await redis.xrange(
        realtimeStreamKey(timelineChannel(follower)),
        '-',
        '+',
      )
      const newEntry = secondEntries.find(([id]) => id !== entryId) as
        | [string, string[]]
        | undefined
      expect(newEntry).toBeDefined()
      expect((received[0] as { eventId: string }).eventId).toBe(newEntry?.[0])
    } finally {
      subscriber.disconnect()
    }
  })

  it('trims a follower timeline down to the retention size', async () => {
    const author = await insertUser(db, { prefix: 'a' })
    const follower = await insertUser(db, { prefix: 'f' })
    await db.insert(follows).values({ followerId: follower, followeeId: author })

    // Pre-fill the timeline past the retention cap directly in Redis —
    // reaching TIMELINE_RETENTION_SIZE through real Postgres posts would
    // make this test unreasonably slow for what it verifies.
    const key = timelineKey(follower)
    const pipeline = redis.pipeline()
    for (let i = 0; i < TIMELINE_RETENTION_SIZE; i++) {
      pipeline.zadd(key, i.toString(), `seed-${i}`)
    }
    await pipeline.exec()

    const repository = createFanoutRepository(db)
    const process = createFanoutProcessor({ repository, redis })
    const postId = generateId()

    await process({ postId: postId.toString(), authorId: author.toString() })

    expect(await redis.zcard(key)).toBe(TIMELINE_RETENTION_SIZE)
    // The newest post survives the trim; the very first seeded (oldest) one doesn't.
    expect(await redis.zscore(key, postId.toString())).not.toBeNull()
    expect(await redis.zscore(key, 'seed-0')).toBeNull()
  })

  it('skips fan-out for accounts at or above the celebrity threshold', async () => {
    const author = await insertUser(db, {
      prefix: 'c',
      followersCount: CELEBRITY_FOLLOWER_THRESHOLD,
    })
    const follower = await insertUser(db, { prefix: 'f' })
    await db.insert(follows).values({ followerId: follower, followeeId: author })

    const repository = createFanoutRepository(db)
    const process = createFanoutProcessor({ repository, redis })

    await process({ postId: generateId().toString(), authorId: author.toString() })

    expect(await redis.exists(timelineKey(follower))).toBe(0)
  })

  it('processes a produced Kafka message end-to-end through a real consumer (ROADMAP.md 3.1)', async () => {
    const author = await insertUser(db, { prefix: 'a' })
    const follower = await insertUser(db, { prefix: 'f' })
    await db.insert(follows).values({ followerId: follower, followeeId: author })

    const repository = createFanoutRepository(db)
    const kafka = new Kafka({
      clientId: 'fanout-test-consumer',
      brokers: kafkaBrokers,
      logLevel: logLevel.ERROR,
    })
    const workerRedis = new Redis(redisContainer.getConnectionUrl())
    const handle = createFanoutWorker({
      repository,
      kafka,
      producer: dlqProducer,
      redis: workerRedis,
      concurrency: 1,
      groupId: `fanout-test-${generateId()}`,
    })
    await handle.start()

    const producer = kafka.producer({ idempotent: true })
    await producer.connect()
    const postId = generateId()
    try {
      await producer.send({
        topic: POST_CREATED_TOPIC,
        messages: [
          {
            key: author.toString(),
            value: JSON.stringify({ postId: postId.toString(), authorId: author.toString() }),
          },
        ],
      })

      const members = await waitFor(async () => {
        const current = await redis.zrange(timelineKey(follower), 0, -1)
        return current.length > 0 ? current : false
      })
      expect(members).toEqual([postId.toString()])
    } finally {
      await producer.disconnect()
      await handle.close()
      workerRedis.disconnect()
    }
  }, 30_000)

  it("sends a message this consumer can't process to the topic's own DLQ after retrying, without wedging the partition (ROADMAP.md 3.1)", async () => {
    const kafka = new Kafka({
      clientId: 'fanout-test-dlq-consumer',
      brokers: kafkaBrokers,
      logLevel: logLevel.ERROR,
    })
    // A repository whose getFollowersCount always throws — every attempt
    // at handling this message fails, forcing the DLQ path for real
    // instead of asserting against mocked internals.
    const brokenRepository = createFanoutRepository(db)
    brokenRepository.getFollowersCount = () => Promise.reject(new Error('simulated failure'))
    const workerRedis = new Redis(redisContainer.getConnectionUrl())
    const handle = createFanoutWorker({
      repository: brokenRepository,
      kafka,
      producer: dlqProducer,
      redis: workerRedis,
      concurrency: 1,
      groupId: `fanout-test-dlq-${generateId()}`,
    })
    await handle.start()

    const dlqConsumer = kafka.consumer({ groupId: `fanout-test-dlq-reader-${generateId()}` })
    await dlqConsumer.connect()
    await dlqConsumer.subscribe({ topic: `${POST_CREATED_TOPIC}.dlq`, fromBeginning: true })
    const dlqMessages: unknown[] = []
    const dlqConsuming = dlqConsumer.run({
      eachMessage: async ({ message }) => {
        if (message.value) dlqMessages.push(JSON.parse(message.value.toString('utf8')))
      },
    })

    const producer = kafka.producer({ idempotent: true })
    await producer.connect()
    const authorId = generateId()
    const postId = generateId()
    try {
      await producer.send({
        topic: POST_CREATED_TOPIC,
        messages: [
          {
            key: authorId.toString(),
            value: JSON.stringify({ postId: postId.toString(), authorId: authorId.toString() }),
          },
        ],
      })

      await waitFor(async () => (dlqMessages.length > 0 ? dlqMessages : false))
      expect(dlqMessages).toEqual([{ postId: postId.toString(), authorId: authorId.toString() }])
    } finally {
      await producer.disconnect()
      await dlqConsumer.disconnect()
      await dlqConsuming.catch(() => {})
      await handle.close()
      workerRedis.disconnect()
    }
  }, 30_000)
})
