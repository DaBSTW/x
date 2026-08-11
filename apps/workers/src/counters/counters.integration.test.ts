import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import {
  type Database,
  bookmarks,
  createDatabase,
  likes,
  migrationsFolderUrl,
  postCounters,
  posts,
  userCounters,
  users,
} from '@x/db'
import { generateId, postCountersKey } from '@x/utils'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCountersFlushWorker } from './counters.flush-worker.js'
import { createCountersRepository } from './counters.repository.js'

describe('counters', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
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

  async function insertPost(
    authorId: bigint,
    overrides: Partial<typeof posts.$inferInsert> = {},
  ): Promise<bigint> {
    const id = generateId()
    await db.insert(posts).values({ id, authorId, conversationId: id, ...overrides })
    await db.insert(postCounters).values({ postId: id })
    return id
  }

  async function readCounters(postId: bigint) {
    const [row] = await db.select().from(postCounters).where(eq(postCounters.postId, postId))
    return row
  }

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

  it('flushCounters writes an absolute set, not an increment', async () => {
    const author = await insertUser('auth')
    const postId = await insertPost(author)
    const repository = createCountersRepository(db)

    await repository.flushCounters(postId, {
      likes: 5,
      reposts: 2,
      replies: 1,
      quotes: 0,
      bookmarks: 3,
    })

    const row = await readCounters(postId)
    expect(row).toMatchObject({
      likesCount: 5,
      repostsCount: 2,
      repliesCount: 1,
      quotesCount: 0,
      bookmarkCount: 3,
    })
  })

  it('the flush worker moves a dirty Redis hash into Postgres', async () => {
    const author = await insertUser('auth')
    const postId = await insertPost(author)
    const repository = createCountersRepository(db)
    const worker = createCountersFlushWorker(repository, redis, 5_000)

    const key = postCountersKey(postId)
    await redis.hset(key, { likes: 7, reposts: 0, replies: 0, quotes: 0, bookmarks: 1 })
    await redis.sadd('dirty:post_counters', postId.toString())

    const flushed = await worker.flushOnce()

    expect(flushed).toBe(1)
    const row = await readCounters(postId)
    expect(row).toMatchObject({ likesCount: 7, bookmarkCount: 1 })
  })

  it('reconcileRecentPosts recomputes from source tables, correcting drift', async () => {
    const author = await insertUser('auth')
    const liker1 = await insertUser('lk1')
    const liker2 = await insertUser('lk2')
    const bookmarker = await insertUser('bmk')
    const postId = await insertPost(author)

    await db.insert(likes).values([
      { userId: liker1, postId },
      { userId: liker2, postId },
    ])
    await db.insert(bookmarks).values({ userId: bookmarker, postId })
    // A repost and a reply — reconciliation must count these too.
    const reposter = await insertUser('rp')
    await insertPost(reposter, { kind: 'repost', repostOfId: postId })
    const replier = await insertUser('rply')
    await insertPost(replier, { kind: 'reply', inReplyToId: postId })

    // Simulate drift: the flush worker never ran, so Postgres still says 0.
    const before = await readCounters(postId)
    expect(before?.likesCount).toBe(0)

    const repository = createCountersRepository(db)
    await repository.reconcileRecentPosts()

    const after = await readCounters(postId)
    expect(after).toMatchObject({
      likesCount: 2,
      bookmarkCount: 1,
      repostsCount: 1,
      repliesCount: 1,
    })
  })
})
