import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { CreateBucketCommand } from '@aws-sdk/client-s3'
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import {
  createDatabase,
  media,
  migrationsFolderUrl,
  postCounters,
  posts,
  userCounters,
} from '@x/db'
import { MEDIA_STATUS, createS3Client, generateId } from '@x/utils'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

const S3_BUCKET = 'x-media'

describe('posts routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let minioContainer: StartedMinioContainer
  let app: FastifyInstance
  let accessToken: string
  let posterId: string

  beforeAll(async () => {
    ;[postgresContainer, redisContainer, mailpitContainer, minioContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      new GenericContainer('axllent/mailpit:latest')
        .withExposedPorts(1025, 8025)
        .withWaitStrategy(Wait.forListeningPorts())
        .start(),
      new MinioContainer('minio/minio:latest').start(),
    ])

    const migrationDb = createDatabase(postgresContainer.getConnectionUri())
    await migrate(migrationDb, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    const s3Endpoint = minioContainer.getConnectionUrl()
    const s3Client = createS3Client({
      endpoint: s3Endpoint,
      region: 'us-east-1',
      accessKeyId: minioContainer.getUsername(),
      secretAccessKey: minioContainer.getPassword(),
      forcePathStyle: true,
    })
    await s3Client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }))

    const env: Env = {
      NODE_ENV: 'test',
      API_PORT: 0,
      WEB_URL: 'http://localhost:3000',
      CORS_ORIGIN: 'http://localhost:3000',
      WORKER_ID: 2,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      // Placeholder — none of this file's tests exercise a Kafka-producing
      // route in a way that asserts on the message, so an unreachable broker
      // is fine (posts.service.ts/social-graph.service.ts already treat a
      // produce failure as non-fatal — ROADMAP.md 3.1).
      KAFKA_BROKERS: 'localhost:9092',
      JWT_ACCESS_TTL_MINUTES: 15,
      REFRESH_TOKEN_TTL_DAYS: 30,
      SMTP_HOST: mailpitContainer.getHost(),
      SMTP_PORT: mailpitContainer.getMappedPort(1025),
      MAIL_FROM: 'no-reply@x.example.com',
      S3_ENDPOINT: s3Endpoint,
      S3_REGION: 'us-east-1',
      S3_BUCKET,
      S3_ACCESS_KEY_ID: minioContainer.getUsername(),
      S3_SECRET_ACCESS_KEY: minioContainer.getPassword(),
      S3_FORCE_PATH_STYLE: true,
      // Query-time only search route — none of this file's tests exercise /search,
      // so a real reachable OpenSearch isn't needed for the app to boot.
      OPENSEARCH_URL: 'http://localhost:9200',
      // This file's tests each register their own user(s) — SPECS.md
      // §11.3's production ceiling (10/15min per IP) is sized for one real
      // client, not this whole file's worth of `it` blocks sharing one IP
      // (see auth.integration.test.ts for the same reasoning).
      LOGIN_RATE_LIMIT_MAX: 100,
      // ROADMAP.md 3.3e — this file's own `poster` (registered once in
      // beforeAll below, reused across almost every `it` block) accumulates
      // more than 10 posts across the whole file's run, seconds apart, not
      // the 24h SPECS.md §12.3's limit is actually meant to bound — same
      // "one shared identity, many `it` blocks" reasoning LOGIN_RATE_LIMIT_MAX
      // above already has, see env.ts's own comment on this var.
      NEW_ACCOUNT_MAX_POSTS_PER_DAY: 1000,
    }
    app = await buildApp(env)

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'poster',
        email: 'poster@example.com',
        password: 'a genuinely unique passphrase 9x2',
        birthDate: '1990-01-01',
      },
    })
    expect(registerResponse.statusCode).toBe(201)
    posterId = registerResponse.json().data.id

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'poster@example.com', password: 'a genuinely unique passphrase 9x2' },
    })
    expect(loginResponse.statusCode).toBe(200)
    accessToken = loginResponse.json().data.accessToken
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([
      postgresContainer.stop(),
      redisContainer.stop(),
      mailpitContainer.stop(),
      minioContainer.stop(),
    ])
  })

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` }
  }

  it('creates, fetches, and soft-deletes a post', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'hola mundo desde el test de integración #dev' },
    })
    expect(createResponse.statusCode).toBe(201)
    const post = createResponse.json().data
    expect(post.text).toContain('hola mundo')
    expect(post.entities).toContainEqual(expect.objectContaining({ kind: 'hashtag', value: 'dev' }))

    const getResponse = await app.inject({ method: 'GET', url: `/v1/posts/${post.id}` })
    expect(getResponse.statusCode).toBe(200)
    expect(getResponse.json().data.id).toBe(post.id)

    // A different (unauthenticated) caller can't delete it.
    const unauthorizedDelete = await app.inject({ method: 'DELETE', url: `/v1/posts/${post.id}` })
    expect(unauthorizedDelete.statusCode).toBe(401)

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/posts/${post.id}`,
      headers: authHeader(),
    })
    expect(deleteResponse.statusCode).toBe(204)

    const getAfterDelete = await app.inject({ method: 'GET', url: `/v1/posts/${post.id}` })
    expect(getAfterDelete.statusCode).toBe(404)
  })

  it('returns 400 for a post with no text', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: {},
    })
    expect(response.statusCode).toBe(400)
  })

  it("rejects a post containing one of Google's own Safe Browsing testing URLs (ROADMAP.md 3.3 preventive layer)", async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'cuidado con http://malware.testing.google.test/testing/malware/' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('attaches ready media to a text-only post and embeds it in the response', async () => {
    const mediaId = generateId()
    await app.db.insert(media).values({
      id: mediaId,
      ownerId: BigInt(posterId),
      storageKey: `media/${mediaId}/original.webp`,
      mimeType: 'image/webp',
      width: 800,
      height: 600,
      sizeBytes: 12_345n,
      blurhash: 'LEHV6nWB2yk8pyo0adR*',
      variants: [{ width: 800, height: 600, format: 'webp', key: `media/${mediaId}/800.webp` }],
      status: MEDIA_STATUS.READY,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'con una imagen', mediaIds: [mediaId.toString()] },
    })

    expect(response.statusCode).toBe(201)
    const post = response.json().data
    expect(post.media).toHaveLength(1)
    expect(post.media[0]).toMatchObject({
      id: mediaId.toString(),
      kind: 'image',
      width: 800,
      height: 600,
      blurhash: 'LEHV6nWB2yk8pyo0adR*',
    })
    expect(post.media[0].url).toContain('800.webp')

    // The same media survives a fresh read, not just the create response.
    const getResponse = await app.inject({ method: 'GET', url: `/v1/posts/${post.id}` })
    expect(getResponse.json().data.media).toHaveLength(1)
  })

  it('accepts a media-only post with no text', async () => {
    const mediaId = generateId()
    await app.db.insert(media).values({
      id: mediaId,
      ownerId: BigInt(posterId),
      storageKey: `media/${mediaId}/original.webp`,
      mimeType: 'image/webp',
      sizeBytes: 100n,
      status: MEDIA_STATUS.READY,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { mediaIds: [mediaId.toString()] },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.text).toBeNull()
  })

  it('rejects attaching media that does not belong to the caller', async () => {
    const otherRegister = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'notposter',
        email: 'notposter@example.com',
        password: 'another unique passphrase 8y3',
        birthDate: '1990-01-01',
      },
    })
    const otherId = BigInt(otherRegister.json().data.id)

    const mediaId = generateId()
    await app.db.insert(media).values({
      id: mediaId,
      ownerId: otherId,
      storageKey: `media/${mediaId}/original.webp`,
      mimeType: 'image/webp',
      sizeBytes: 100n,
      status: MEDIA_STATUS.READY,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'no debería funcionar', mediaIds: [mediaId.toString()] },
    })

    expect(response.statusCode).toBe(400)
  })

  it('dedupes creates that share an Idempotency-Key', async () => {
    const idempotencyKey = randomUUID()
    const payload = { text: 'un post idempotente' }

    const first = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { ...authHeader(), 'idempotency-key': idempotencyKey },
      payload,
    })
    const second = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { ...authHeader(), 'idempotency-key': idempotencyKey },
      payload,
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(first.json().data.id).toBe(second.json().data.id)
  })

  it('resolves a reply thread through conversationId', async () => {
    const rootResponse = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'raíz del hilo' },
    })
    const root = rootResponse.json().data

    const replyResponse = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'una respuesta', inReplyToId: root.id },
    })
    expect(replyResponse.statusCode).toBe(201)
    expect(replyResponse.json().data.conversationId).toBe(root.id)
  })

  it('POST /posts/batch creates a whole thread, each post replying to the one before it (ROADMAP.md 2.1)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts/batch',
      headers: authHeader(),
      payload: { posts: [{ text: 'uno' }, { text: 'dos' }, { text: 'tres, con #hilo' }] },
    })

    expect(response.statusCode).toBe(201)
    const thread = response.json().data
    expect(thread.map((post: { text: string }) => post.text)).toEqual([
      'uno',
      'dos',
      'tres, con #hilo',
    ])
    expect(thread[0].inReplyToId).toBeNull()
    expect(thread[1].inReplyToId).toBe(thread[0].id)
    expect(thread[2].inReplyToId).toBe(thread[1].id)
    expect(thread[1].conversationId).toBe(thread[0].id)
    expect(thread[2].conversationId).toBe(thread[0].id)

    // Every post actually landed, independently readable, not just present
    // in the create response.
    for (const post of thread) {
      const getResponse = await app.inject({ method: 'GET', url: `/v1/posts/${post.id}` })
      expect(getResponse.statusCode).toBe(200)
    }
  })

  it('POST /posts/batch replies to an existing post when inReplyToId is given', async () => {
    const root = (
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: authHeader(),
        payload: { text: 'raíz externa para el hilo' },
      })
    ).json().data

    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts/batch',
      headers: authHeader(),
      payload: { posts: [{ text: 'uno' }, { text: 'dos' }], inReplyToId: root.id },
    })

    expect(response.statusCode).toBe(201)
    const thread = response.json().data
    expect(thread[0].inReplyToId).toBe(root.id)
    expect(thread[0].conversationId).toBe(root.id)
    expect(thread[1].conversationId).toBe(root.id)

    const rootThread = await app.inject({ method: 'GET', url: `/v1/posts/${root.id}/thread` })
    expect(rootThread.json().data.replies.map((post: { id: string }) => post.id)).toEqual([
      thread[0].id,
    ])
  })

  it('POST /posts/batch rolls back the whole thread when one item has invalid media (transactional, ROADMAP.md 2.1)', async () => {
    const otherRegister = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'threadstranger',
        email: 'threadstranger@example.com',
        password: 'a unique passphrase, stranger 9q',
        birthDate: '1990-01-01',
      },
    })
    const otherId = otherRegister.json().data.id
    const foreignMediaId = generateId()
    await app.db.insert(media).values({
      id: foreignMediaId,
      ownerId: BigInt(otherId),
      storageKey: `media/${foreignMediaId}/original.webp`,
      mimeType: 'image/webp',
      sizeBytes: 100n,
      status: MEDIA_STATUS.READY,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts/batch',
      headers: authHeader(),
      payload: {
        posts: [
          { text: 'este sí debería existir si no fuera por el siguiente' },
          { mediaIds: [foreignMediaId.toString()] },
        ],
      },
    })

    expect(response.statusCode).toBe(400)

    // Nothing from the failed thread persisted — not even its first item,
    // which would have succeeded on its own outside a transaction.
    const profile = await app.inject({ method: 'GET', url: '/v1/users/poster/posts' })
    const leaked = profile
      .json()
      .data.some((post: { text: string | null }) => post.text?.includes('este sí debería existir'))
    expect(leaked).toBe(false)
  })

  it('returns 400 for an empty thread', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/posts/batch',
      headers: authHeader(),
      payload: { posts: [] },
    })
    expect(response.statusCode).toBe(400)
  })

  it('paginates a user timeline by cursor', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: authHeader(),
        payload: { text: `post de paginación ${i}` },
      })
    }

    const firstPage = await app.inject({ method: 'GET', url: '/v1/users/poster/posts?limit=2' })
    expect(firstPage.statusCode).toBe(200)
    const firstBody = firstPage.json()
    expect(firstBody.data).toHaveLength(2)
    expect(firstBody.meta.hasMore).toBe(true)
    expect(firstBody.meta.nextCursor).toBeTruthy()

    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/users/poster/posts?limit=2&cursor=${encodeURIComponent(firstBody.meta.nextCursor)}`,
    })
    expect(secondPage.statusCode).toBe(200)
    const secondIds = new Set(secondPage.json().data.map((p: { id: string }) => p.id))
    const firstIds = new Set(firstBody.data.map((p: { id: string }) => p.id))
    for (const id of secondIds) {
      expect(firstIds.has(id)).toBe(false)
    }
  })

  it('returns 404 for a nonexistent username', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users/ghost-user/posts' })
    expect(response.statusCode).toBe(404)
  })

  // The "posts"/"replies" split is plain in-memory logic, covered by
  // posts.service.test.ts — these two exercise the filters that actually
  // depend on real SQL (an EXISTS against media/likes), which a fake
  // repository can't meaningfully stand in for.
  it('filters to only posts with attached media when filter=media', async () => {
    const mediaId = generateId()
    await app.db.insert(media).values({
      id: mediaId,
      ownerId: BigInt(posterId),
      storageKey: `media/${mediaId}/original.webp`,
      mimeType: 'image/webp',
      sizeBytes: 100n,
      status: MEDIA_STATUS.READY,
    })
    const withMedia = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'con media, para el filtro', mediaIds: [mediaId.toString()] },
    })
    const withoutMedia = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'sin media, para el filtro' },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/poster/posts?filter=media&limit=50',
    })

    expect(response.statusCode).toBe(200)
    const ids = response.json().data.map((post: { id: string }) => post.id)
    expect(ids).toContain(withMedia.json().data.id)
    expect(ids).not.toContain(withoutMedia.json().data.id)
  })

  it('filters to posts the user liked, not authored, when filter=likes', async () => {
    const otherRegister = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'likedby',
        email: 'likedby@example.com',
        password: 'yet another unique passphrase 7z',
        birthDate: '1990-01-01',
      },
    })
    expect(otherRegister.statusCode).toBe(201)
    const otherLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'likedby@example.com', password: 'yet another unique passphrase 7z' },
    })
    const otherToken = otherLogin.json().data.accessToken

    const othersPost = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { text: 'post de otro usuario' },
    })
    const othersPostId = othersPost.json().data.id

    const likeResponse = await app.inject({
      method: 'POST',
      url: `/v1/posts/${othersPostId}/like`,
      headers: authHeader(),
    })
    expect(likeResponse.statusCode).toBe(204)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/poster/posts?filter=likes&limit=50',
    })

    expect(response.statusCode).toBe(200)
    const ids = response.json().data.map((post: { id: string }) => post.id)
    expect(ids).toContain(othersPostId)
  })

  it('GET /posts/:id/thread returns the ancestor chain root-first, the post, and its replies', async () => {
    const root = (
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: authHeader(),
        payload: { text: 'raíz del hilo, para /thread' },
      })
    ).json().data
    const middle = (
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: authHeader(),
        payload: { text: 'en medio', inReplyToId: root.id },
      })
    ).json().data
    const leaf = (
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: authHeader(),
        payload: { text: 'la hoja', inReplyToId: middle.id },
      })
    ).json().data
    const reply = (
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: authHeader(),
        payload: { text: 'respuesta a la hoja', inReplyToId: leaf.id },
      })
    ).json().data

    const response = await app.inject({ method: 'GET', url: `/v1/posts/${leaf.id}/thread` })

    expect(response.statusCode).toBe(200)
    const body = response.json().data
    expect(body.ancestors.map((post: { id: string }) => post.id)).toEqual([root.id, middle.id])
    expect(body.post.id).toBe(leaf.id)
    expect(body.replies.map((post: { id: string }) => post.id)).toEqual([reply.id])
    expect(body.meta.hasMoreReplies).toBe(false)
    expect(body.meta.nextCursor).toBeNull()
  })

  it('GET /posts/:id/thread\'s nextCursor feeds straight into GET /posts/:id/replies for <ThreadView>\'s "cargar más respuestas" (ROADMAP.md 2.1)', async () => {
    const root = (
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: authHeader(),
        payload: { text: 'raíz con más respuestas que una página' },
      })
    ).json().data
    const rootId = BigInt(root.id)

    // 21 replies, bulk-inserted like the 50k-replies test above — one more
    // than THREAD_REPLIES_PAGE_SIZE (20, posts.service.ts), so the thread's
    // own first page is guaranteed to leave exactly one reply for "cargar
    // más" to fetch.
    const REPLY_COUNT = 21
    const postRows: (typeof posts.$inferInsert)[] = []
    const counterRows: (typeof postCounters.$inferInsert)[] = []
    for (let i = 0; i < REPLY_COUNT; i++) {
      const id = generateId()
      postRows.push({
        id,
        authorId: BigInt(posterId),
        kind: 'reply',
        inReplyToId: rootId,
        conversationId: rootId,
      })
      counterRows.push({ postId: id })
    }
    await app.db.insert(posts).values(postRows)
    await app.db.insert(postCounters).values(counterRows)
    // Newest-first, same ordering as every other list.
    const oldestReplyId = postRows[0]?.id.toString()

    const threadResponse = await app.inject({ method: 'GET', url: `/v1/posts/${root.id}/thread` })
    const thread = threadResponse.json().data
    expect(thread.replies).toHaveLength(20)
    expect(thread.meta.hasMoreReplies).toBe(true)
    expect(thread.meta.nextCursor).toBeTruthy()
    // The oldest reply (first inserted, so it sorts last) isn't on this page.
    expect(thread.replies.map((post: { id: string }) => post.id)).not.toContain(oldestReplyId)

    const nextPage = await app.inject({
      method: 'GET',
      url: `/v1/posts/${root.id}/replies?cursor=${encodeURIComponent(thread.meta.nextCursor)}`,
    })
    expect(nextPage.statusCode).toBe(200)
    // Exactly the one reply the thread's first page left behind.
    expect(nextPage.json().data.map((post: { id: string }) => post.id)).toEqual([oldestReplyId])
  })

  it('embeds the quoted post one level deep, over the wire, everywhere a post is read (ROADMAP.md 2.1 "Citas")', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'citable',
        email: 'citable@example.com',
        password: 'a unique passphrase, citable 8p',
        birthDate: '1990-01-01',
      },
    })
    const citableLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'citable@example.com', password: 'a unique passphrase, citable 8p' },
    })
    const citableToken = citableLogin.json().data.accessToken

    const quoted = (
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: { authorization: `Bearer ${citableToken}` },
        payload: { text: 'post citable desde el test de integración' },
      })
    ).json().data

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'una cita desde el test de integración', quotedPostId: quoted.id },
    })
    expect(createResponse.statusCode).toBe(201)
    const quote = createResponse.json().data
    expect(quote.quotedPost).toMatchObject({
      id: quoted.id,
      text: 'post citable desde el test de integración',
      author: { username: 'citable' },
    })

    // GET /posts/:id — a second, independent read path resolves it too, not
    // just the create response.
    const getResponse = await app.inject({ method: 'GET', url: `/v1/posts/${quote.id}` })
    expect(getResponse.json().data.quotedPost).toMatchObject({ id: quoted.id })

    // GET /users/:username/posts — the batch-hydrated profile-page path.
    const profileResponse = await app.inject({ method: 'GET', url: '/v1/users/poster/posts' })
    const quoteOnProfile = profileResponse
      .json()
      .data.find((post: { id: string }) => post.id === quote.id)
    expect(quoteOnProfile.quotedPost).toMatchObject({ id: quoted.id })

    // Postgres, not Redis, backs every counters read in this module (SPECS.md
    // §4.4) — the create above bumped Redis, but apps/workers' 5s flush to
    // Postgres isn't running in this API-only test, so the embedded post's
    // own counters.quotes still reads 0 here (same reasoning as
    // interactions.integration.test.ts's "100 concurrent likes" test). Not a
    // bug in the embed — it's reading through the same primitive
    // (findCountersForPosts) every other post response already does.
    expect(quoteOnProfile.quotedPost.counters.quotes).toBe(0)
    // And the embed doesn't itself carry a further quotedPost key.
    expect('quotedPost' in quoteOnProfile.quotedPost).toBe(false)
  })

  // ROADMAP.md 1.4: GET /posts/:id's `viewer` field — deferred there
  // originally for "needs optional auth", which 2.6 later added without
  // anyone wiring this up too. Exercises the real interactionsRepository/
  // postsRepository queries app.ts wires into postsService's viewerState,
  // not the fake ones posts.service.test.ts uses.
  it('GET /posts/:id reports the real viewer.liked/bookmarked/reposted state, per caller', async () => {
    const viewerRegister = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'viewerstate',
        email: 'viewerstate@example.com',
        password: 'a unique passphrase, viewer 6k',
        birthDate: '1990-01-01',
      },
    })
    expect(viewerRegister.statusCode).toBe(201)
    const viewerLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'viewerstate@example.com', password: 'a unique passphrase, viewer 6k' },
    })
    const viewerToken = viewerLogin.json().data.accessToken
    const viewerAuthHeader = { authorization: `Bearer ${viewerToken}` }

    const created = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: authHeader(),
      payload: { text: 'post para probar el estado del viewer' },
    })
    const postId = created.json().data.id

    // Anonymous: no viewer field at all.
    const anonymous = await app.inject({ method: 'GET', url: `/v1/posts/${postId}` })
    expect(anonymous.json().data.viewer).toBeUndefined()

    // Signed in, no interaction yet: all three false, not absent.
    const beforeInteracting = await app.inject({
      method: 'GET',
      url: `/v1/posts/${postId}`,
      headers: viewerAuthHeader,
    })
    expect(beforeInteracting.json().data.viewer).toEqual({
      liked: false,
      bookmarked: false,
      reposted: false,
    })

    await app.inject({
      method: 'POST',
      url: `/v1/posts/${postId}/like`,
      headers: viewerAuthHeader,
    })
    await app.inject({
      method: 'POST',
      url: `/v1/posts/${postId}/bookmark`,
      headers: viewerAuthHeader,
    })
    await app.inject({
      method: 'POST',
      url: `/v1/posts/${postId}/repost`,
      headers: viewerAuthHeader,
    })

    // reposted comes from postsRepository.findRepostedPostIds (a query
    // against posts itself, kind = 'repost') — a genuinely different table
    // than liked/bookmarked's interactionsRepository, so this is the one
    // check of the three that isn't just re-exercising the same query twice.
    const afterInteracting = await app.inject({
      method: 'GET',
      url: `/v1/posts/${postId}`,
      headers: viewerAuthHeader,
    })
    expect(afterInteracting.json().data.viewer).toEqual({
      liked: true,
      bookmarked: true,
      reposted: true,
    })

    // Someone else who never interacted still reads all-false — viewer
    // state is per caller, not a property of the post itself.
    const otherRegister = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'viewerstate2',
        email: 'viewerstate2@example.com',
        password: 'a unique passphrase, viewer2 6k',
        birthDate: '1990-01-01',
      },
    })
    expect(otherRegister.statusCode).toBe(201)
    const otherLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'viewerstate2@example.com', password: 'a unique passphrase, viewer2 6k' },
    })
    const otherToken = otherLogin.json().data.accessToken

    const otherView = await app.inject({
      method: 'GET',
      url: `/v1/posts/${postId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    })
    expect(otherView.json().data.viewer).toEqual({
      liked: false,
      bookmarked: false,
      reposted: false,
    })
  })

  it('GET /posts/:id/replies paginates a post’s direct replies by cursor', async () => {
    const root = (
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: authHeader(),
        payload: { text: 'raíz, para /replies' },
      })
    ).json().data
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: authHeader(),
        payload: { text: `respuesta ${i}`, inReplyToId: root.id },
      })
    }

    const firstPage = await app.inject({
      method: 'GET',
      url: `/v1/posts/${root.id}/replies?limit=2`,
    })
    expect(firstPage.statusCode).toBe(200)
    const firstBody = firstPage.json()
    expect(firstBody.data).toHaveLength(2)
    expect(firstBody.meta.hasMore).toBe(true)

    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/posts/${root.id}/replies?limit=2&cursor=${encodeURIComponent(firstBody.meta.nextCursor)}`,
    })
    expect(secondPage.statusCode).toBe(200)
    expect(secondPage.json().data).toHaveLength(1)
  })

  it('enforces reply_policy "following": a stranger is rejected, a followed account is allowed', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'policyowner',
        email: 'policyowner@example.com',
        password: 'a unique passphrase for policy 4k',
        birthDate: '1990-01-01',
      },
    })
    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'policyowner@example.com', password: 'a unique passphrase for policy 4k' },
    })
    const ownerToken = ownerLogin.json().data.accessToken

    const stranger = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'policystranger',
        email: 'policystranger@example.com',
        password: 'a unique passphrase, stranger 5m',
        birthDate: '1990-01-01',
      },
    })
    const strangerLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'policystranger@example.com',
        password: 'a unique passphrase, stranger 5m',
      },
    })
    const strangerToken = strangerLogin.json().data.accessToken
    const strangerId = stranger.json().data.id

    const root = (
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { text: 'solo respuestas de gente que sigo', replyPolicy: 'following' },
      })
    ).json().data

    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { text: 'intento de respuesta', inReplyToId: root.id },
    })
    expect(rejected.statusCode).toBe(403)

    const follow = await app.inject({
      method: 'POST',
      url: `/v1/users/${strangerId}/follow`,
      headers: { authorization: `Bearer ${ownerToken}` },
    })
    expect(follow.statusCode).toBe(200)

    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { text: 'ahora sí puedo responder', inReplyToId: root.id },
    })
    expect(allowed.statusCode).toBe(201)
  })

  it("hides a blocked author's posts from the blocked viewer, everywhere, while staying visible to everyone else (ROADMAP.md 2.6)", async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'blockedauthor',
        email: 'blockedauthor@example.com',
        password: 'a unique passphrase, author 8p',
        birthDate: '1990-01-01',
      },
    })
    const authorLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'blockedauthor@example.com', password: 'a unique passphrase, author 8p' },
    })
    const authorToken = authorLogin.json().data.accessToken

    const viewerRegister = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'blockedviewer',
        email: 'blockedviewer@example.com',
        password: 'a unique passphrase, viewer 8p',
        birthDate: '1990-01-01',
      },
    })
    const viewerId = viewerRegister.json().data.id
    const viewerLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'blockedviewer@example.com', password: 'a unique passphrase, viewer 8p' },
    })
    const viewerToken = viewerLogin.json().data.accessToken

    const post = (
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: { authorization: `Bearer ${authorToken}` },
        payload: { text: 'un post que no deberías ver' },
      })
    ).json().data

    const blockResponse = await app.inject({
      method: 'POST',
      url: `/v1/users/${viewerId}/block`,
      headers: { authorization: `Bearer ${authorToken}` },
    })
    expect(blockResponse.statusCode).toBe(204)

    const getByIdAsBlocked = await app.inject({
      method: 'GET',
      url: `/v1/posts/${post.id}`,
      headers: { authorization: `Bearer ${viewerToken}` },
    })
    expect(getByIdAsBlocked.statusCode).toBe(404)

    const threadAsBlocked = await app.inject({
      method: 'GET',
      url: `/v1/posts/${post.id}/thread`,
      headers: { authorization: `Bearer ${viewerToken}` },
    })
    expect(threadAsBlocked.statusCode).toBe(404)

    const profileAsBlocked = await app.inject({
      method: 'GET',
      url: '/v1/users/blockedauthor/posts',
      headers: { authorization: `Bearer ${viewerToken}` },
    })
    expect(profileAsBlocked.statusCode).toBe(200)
    expect(profileAsBlocked.json().data).toEqual([])

    // No block relationship with this request at all — anonymous and third
    // parties keep seeing the post normally.
    const getByIdAnonymous = await app.inject({ method: 'GET', url: `/v1/posts/${post.id}` })
    expect(getByIdAnonymous.statusCode).toBe(200)
  })

  it("hides a protected account's posts from anyone but themself and an approved follower (ROADMAP.md 2.6)", async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'protectedauthor',
        email: 'protectedauthor@example.com',
        password: 'a unique passphrase, prot author',
        birthDate: '1990-01-01',
      },
    })
    const authorLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'protectedauthor@example.com',
        password: 'a unique passphrase, prot author',
      },
    })
    const authorToken = authorLogin.json().data.accessToken

    const protect = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { isProtected: true },
    })
    const authorId = protect.json().data.id

    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'protstranger',
        email: 'protstranger@example.com',
        password: 'a unique passphrase, prot stranger',
        birthDate: '1990-01-01',
      },
    })
    const strangerLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'protstranger@example.com',
        password: 'a unique passphrase, prot stranger',
      },
    })
    const strangerToken = strangerLogin.json().data.accessToken

    const followerRegister = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'protfollower',
        email: 'protfollower@example.com',
        password: 'a unique passphrase, prot follower',
        birthDate: '1990-01-01',
      },
    })
    const followerId = followerRegister.json().data.id
    const followerLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'protfollower@example.com',
        password: 'a unique passphrase, prot follower',
      },
    })
    const followerToken = followerLogin.json().data.accessToken

    const post = (
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: { authorization: `Bearer ${authorToken}` },
        payload: { text: 'un post protegido' },
      })
    ).json().data

    // A request, then acceptance, makes the follower approved.
    await app.inject({
      method: 'POST',
      url: `/v1/users/${authorId}/follow`,
      headers: { authorization: `Bearer ${followerToken}` },
    })
    const accept = await app.inject({
      method: 'POST',
      url: `/v1/users/me/follow-requests/${followerId}/accept`,
      headers: { authorization: `Bearer ${authorToken}` },
    })
    expect(accept.statusCode).toBe(204)

    const getByIdAsStranger = await app.inject({
      method: 'GET',
      url: `/v1/posts/${post.id}`,
      headers: { authorization: `Bearer ${strangerToken}` },
    })
    expect(getByIdAsStranger.statusCode).toBe(404)

    const getByIdAnonymous = await app.inject({ method: 'GET', url: `/v1/posts/${post.id}` })
    expect(getByIdAnonymous.statusCode).toBe(404)

    const profileAsStranger = await app.inject({
      method: 'GET',
      url: '/v1/users/protectedauthor/posts',
      headers: { authorization: `Bearer ${strangerToken}` },
    })
    expect(profileAsStranger.statusCode).toBe(200)
    expect(profileAsStranger.json().data).toEqual([])

    const getByIdAsFollower = await app.inject({
      method: 'GET',
      url: `/v1/posts/${post.id}`,
      headers: { authorization: `Bearer ${followerToken}` },
    })
    expect(getByIdAsFollower.statusCode).toBe(200)

    const profileAsFollower = await app.inject({
      method: 'GET',
      url: '/v1/users/protectedauthor/posts',
      headers: { authorization: `Bearer ${followerToken}` },
    })
    expect(profileAsFollower.statusCode).toBe(200)
    expect(profileAsFollower.json().data).toHaveLength(1)
    expect(profileAsFollower.json().data[0].id).toBe(post.id)

    const getByIdAsAuthor = await app.inject({
      method: 'GET',
      url: `/v1/posts/${post.id}`,
      headers: { authorization: `Bearer ${authorToken}` },
    })
    expect(getByIdAsAuthor.statusCode).toBe(200)
  })

  it('deleting a post with 50,000 replies is O(1) and leaves no orphans or inconsistent counters (SPECS.md §17.3)', async () => {
    const root = (
      await app.inject({
        method: 'POST',
        url: '/v1/posts',
        headers: authHeader(),
        payload: { text: 'raíz con 50 000 respuestas' },
      })
    ).json().data
    const rootId = BigInt(root.id)

    // Bulk-inserted directly against Postgres, not via 50,000 individual
    // POST /posts calls — this test is about softDeletePost's own behavior
    // at scale, not about re-proving posts.service.ts's create() path (that's
    // covered elsewhere). Chunked at 5,000 rows/statement to stay well under
    // Postgres's 65535-parameter limit per statement.
    const REPLY_COUNT = 50_000
    const BATCH_SIZE = 5_000
    let firstReplyId: bigint | undefined
    for (let inserted = 0; inserted < REPLY_COUNT; inserted += BATCH_SIZE) {
      const postRows: (typeof posts.$inferInsert)[] = []
      const counterRows: (typeof postCounters.$inferInsert)[] = []
      for (let i = 0; i < BATCH_SIZE; i++) {
        const id = generateId()
        firstReplyId ??= id
        postRows.push({
          id,
          authorId: BigInt(posterId),
          kind: 'reply',
          inReplyToId: rootId,
          conversationId: rootId,
        })
        counterRows.push({ postId: id })
      }
      await app.db.insert(posts).values(postRows)
      await app.db.insert(postCounters).values(counterRows)
    }

    // The bulk insert above never went through insertPost's `postsCount + 1`
    // update, so this is whatever the shared `poster` account already
    // accumulated from every earlier test in this file — the assertion below
    // checks the *delta* the delete produces, not this absolute number.
    const [before] = await app.db
      .select({ postsCount: userCounters.postsCount })
      .from(userCounters)
      .where(eq(userCounters.userId, BigInt(posterId)))

    const startedAt = Date.now()
    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/posts/${root.id}`,
      headers: authHeader(),
    })
    const elapsedMs = Date.now() - startedAt

    expect(deleteResponse.statusCode).toBe(204)
    // O(1): softDeletePost touches exactly the root row and one userCounters
    // row, never the replies — a regression to an O(n) cascade would take
    // seconds against 50,000 rows, not milliseconds, even on a modest
    // Testcontainers instance.
    expect(elapsedMs).toBeLessThan(5_000)

    // The root itself is gone...
    const getRoot = await app.inject({ method: 'GET', url: `/v1/posts/${root.id}` })
    expect(getRoot.statusCode).toBe(404)

    // ...but none of the 50,000 replies were touched: no orphans, still
    // exactly 50,000 non-deleted rows pointing at the now-gone root.
    const survivingReplies = await app.db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(eq(posts.inReplyToId, rootId), isNull(posts.deletedAt)))
    expect(survivingReplies[0]?.count).toBe(REPLY_COUNT)

    // Spot check: an individual reply is still independently readable.
    if (firstReplyId !== undefined) {
      const getReply = await app.inject({ method: 'GET', url: `/v1/posts/${firstReplyId}` })
      expect(getReply.statusCode).toBe(200)
    }

    // The author's postsCount decremented by exactly 1 for the root — not by
    // 50,001, and not left inconsistent either.
    const [after] = await app.db
      .select({ postsCount: userCounters.postsCount })
      .from(userCounters)
      .where(eq(userCounters.userId, BigInt(posterId)))
    expect(after?.postsCount).toBe((before?.postsCount ?? 0) - 1)
  })
})
