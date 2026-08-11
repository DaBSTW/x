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
  timelineKey,
} from '@x/utils'
import { Queue } from 'bullmq'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
