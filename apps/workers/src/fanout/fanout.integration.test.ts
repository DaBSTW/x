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
  TIMELINE_RETENTION_SIZE,
  generateId,
  realtimeStreamKey,
  timelineChannel,
  timelineKey,
} from '@x/utils'
import { Queue } from 'bullmq'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createFanoutProcessor } from './fanout.processor.js'
import { createFanoutRepository } from './fanout.repository.js'
import { createFanoutWorker } from './fanout.worker.js'

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
  let db: Database
  let redis: Redis

  beforeAll(async () => {
    ;[postgresContainer, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ])

    db = createDatabase(postgresContainer.getConnectionUri())
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })
    redis = new Redis(redisContainer.getConnectionUrl())
  }, 120_000)

  afterAll(async () => {
    redis.disconnect()
    await Promise.all([postgresContainer.stop(), redisContainer.stop()])
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

  it('processes a queued job end-to-end through a real BullMQ worker', async () => {
    const author = await insertUser(db, { prefix: 'a' })
    const follower = await insertUser(db, { prefix: 'f' })
    await db.insert(follows).values({ followerId: follower, followeeId: author })

    const repository = createFanoutRepository(db)
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`
    const handle = createFanoutWorker({ repository, redisUrl, concurrency: 1 })
    const queue = new Queue(handle.worker.name, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })
    const postId = generateId()

    const completed = new Promise<void>((resolve, reject) => {
      handle.worker.on('completed', (job) => {
        if (job.data.postId === postId.toString()) resolve()
      })
      handle.worker.on('failed', (_job, error) => reject(error))
    })
    await queue.add('fanout', { postId: postId.toString(), authorId: author.toString() })
    await completed

    const members = await redis.zrange(timelineKey(follower), 0, -1)
    expect(members).toEqual([postId.toString()])

    await queue.close()
    await handle.close()
  }, 30_000)
})
