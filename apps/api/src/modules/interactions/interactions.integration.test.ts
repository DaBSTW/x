import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import {
  type Database,
  createDatabase,
  migrationsFolderUrl,
  postCounters,
  userCounters,
  users,
} from '@x/db'
import { generateId, postCountersKey } from '@x/utils'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { Redis } from 'ioredis'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'
import { createPostsRepository } from '../posts/posts.repository.js'
import { createPostsService } from '../posts/posts.service.js'
import { createInteractionsRepository } from './interactions.repository.js'
import { createInteractionsService } from './interactions.service.js'

describe('interactions routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let app: FastifyInstance
  let aliceToken: string
  let postId: string

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
      WORKER_ID: 5,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      JWT_ACCESS_TTL_MINUTES: 15,
      REFRESH_TOKEN_TTL_DAYS: 30,
      SMTP_HOST: mailpitContainer.getHost(),
      SMTP_PORT: mailpitContainer.getMappedPort(1025),
      MAIL_FROM: 'no-reply@x.example.com',
    }
    app = await buildApp(env)

    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'alice',
        email: 'alice@example.com',
        password: 'a unique passphrase for alice 7q',
        birthDate: '1990-01-01',
      },
    })
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'alice@example.com', password: 'a unique passphrase for alice 7q' },
    })
    aliceToken = login.json().data.accessToken

    const post = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { text: 'un post para interactuar' },
    })
    postId = post.json().data.id
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), mailpitContainer.stop()])
  })

  function auth() {
    return { authorization: `Bearer ${aliceToken}` }
  }

  it('likes, rejects a duplicate like, and unlikes', async () => {
    const like = await app.inject({
      method: 'POST',
      url: `/v1/posts/${postId}/like`,
      headers: auth(),
    })
    expect(like.statusCode).toBe(204)

    const duplicate = await app.inject({
      method: 'POST',
      url: `/v1/posts/${postId}/like`,
      headers: auth(),
    })
    expect(duplicate.statusCode).toBe(409)

    const unlike = await app.inject({
      method: 'DELETE',
      url: `/v1/posts/${postId}/like`,
      headers: auth(),
    })
    expect(unlike.statusCode).toBe(204)

    // Idempotent: unliking an already-unliked post is not an error.
    const unlikeAgain = await app.inject({
      method: 'DELETE',
      url: `/v1/posts/${postId}/like`,
      headers: auth(),
    })
    expect(unlikeAgain.statusCode).toBe(204)
  })

  it('bookmarks and unbookmarks', async () => {
    const bookmark = await app.inject({
      method: 'POST',
      url: `/v1/posts/${postId}/bookmark`,
      headers: auth(),
    })
    expect(bookmark.statusCode).toBe(204)

    const unbookmark = await app.inject({
      method: 'DELETE',
      url: `/v1/posts/${postId}/bookmark`,
      headers: auth(),
    })
    expect(unbookmark.statusCode).toBe(204)
  })

  it('reposts, rejects a duplicate repost, and undoes it', async () => {
    const repost = await app.inject({
      method: 'POST',
      url: `/v1/posts/${postId}/repost`,
      headers: auth(),
    })
    expect(repost.statusCode).toBe(201)
    expect(repost.json().data.text).toBeNull()

    const duplicate = await app.inject({
      method: 'POST',
      url: `/v1/posts/${postId}/repost`,
      headers: auth(),
    })
    expect(duplicate.statusCode).toBe(409)

    const undo = await app.inject({
      method: 'DELETE',
      url: `/v1/posts/${postId}/repost`,
      headers: auth(),
    })
    expect(undo.statusCode).toBe(204)

    // Reposting again must succeed now that the previous one is undone.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/posts/${postId}/repost`,
      headers: auth(),
    })
    expect(again.statusCode).toBe(201)
  })

  it('returns 404 liking a nonexistent post', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts/999999999999999999/like',
      headers: auth(),
    })
    expect(response.statusCode).toBe(404)
  })

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'POST', url: `/v1/posts/${postId}/like` })
    expect(response.statusCode).toBe(401)
  })
})

describe('counter concurrency', () => {
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

  it('ROADMAP.md 1.4: 100 concurrent likes settle to an exact counter', async () => {
    const author = await insertUser('auth')
    const postsRepository = createPostsRepository(db)
    const postsService = createPostsService(postsRepository)
    const original = await postsService.create(author, {
      text: 'post muy popular',
      replyPolicy: 'everyone',
      isSensitive: false,
    })
    const postId = BigInt(original.id)

    const interactionsService = createInteractionsService(
      createInteractionsRepository(db),
      postsRepository,
      postsService,
      redis,
    )
    const likerIds = await Promise.all(Array.from({ length: 100 }, () => insertUser('liker')))

    await Promise.all(likerIds.map((likerId) => interactionsService.like(likerId, postId)))

    // Redis is authoritative for reads (SPECS.md §4.4) — the exact count
    // must land there even though apps/workers' 5s flush hasn't run yet in
    // this test (that hand-off to Postgres is covered by
    // apps/workers/src/counters/counters.integration.test.ts).
    const raw = await redis.hgetall(postCountersKey(postId))
    expect(Number(raw.likes)).toBe(100)

    const [row] = await db.select().from(postCounters).where(eq(postCounters.postId, postId))
    expect(row?.likesCount).toBe(0)
  }, 30_000)
})
