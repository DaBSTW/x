import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { CreateBucketCommand } from '@aws-sdk/client-s3'
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, media, migrationsFolderUrl } from '@x/db'
import { MEDIA_STATUS, createS3Client, generateId } from '@x/utils'
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
    expect(follow.statusCode).toBe(204)

    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { text: 'ahora sí puedo responder', inReplyToId: root.id },
    })
    expect(allowed.statusCode).toBe(201)
  })
})
