import { fileURLToPath } from 'node:url'
import { CreateBucketCommand } from '@aws-sdk/client-s3'
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, migrationsFolderUrl } from '@x/db'
import { createS3Client } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

const S3_BUCKET = 'x-media'

// A real 2x2 WebP file's bytes (generated via sharp and verified to decode
// back to width:2/height:2 before being hardcoded here) — small enough to
// inline, real enough that sharp can decode it for the dimension check, same
// as a genuine upload would be.
const TINY_WEBP = Buffer.from(
  'UklGRjoAAABXRUJQVlA4IC4AAACwAQCdASoCAAIAAUAmJaACdLoABDAAAP7vUS/xbSOhTIf/cHH/YOP+wcfumAAA',
  'base64',
)

describe('media routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let minioContainer: StartedMinioContainer
  let app: FastifyInstance
  let accessToken: string

  async function registerAndLogin(username: string) {
    const email = `${username}@example.com`
    const password = `a unique passphrase for ${username} 7q`
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username, email, password, birthDate: '1990-01-01' },
    })
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    })
    return loginResponse.json().data.accessToken as string
  }

  async function requestUploadUrl(token: string, mimeType: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/media/upload-url',
      headers: { authorization: `Bearer ${token}` },
      payload: { mimeType },
    })
    expect(response.statusCode).toBe(201)
    return response.json().data as { mediaId: string; uploadUrl: string }
  }

  async function putToPresignedUrl(uploadUrl: string, body: Buffer, contentType: string) {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': contentType },
    })
    expect(response.ok).toBe(true)
  }

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
      WORKER_ID: 5,
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
      // Query-time only search route — none of this file's tests exercise /search,
      // so a real reachable OpenSearch isn't needed for the app to boot.
      OPENSEARCH_URL: 'http://localhost:9200',
    }
    app = await buildApp(env)
    accessToken = await registerAndLogin('mediauser')
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

  it('requires authentication for every media route', async () => {
    // A valid body, deliberately: schema validation runs before the auth
    // preHandler, so an invalid body would 400 before ever reaching the
    // check this test wants to isolate.
    const upload = await app.inject({
      method: 'POST',
      url: '/v1/media/upload-url',
      payload: { mimeType: 'image/webp' },
    })
    expect(upload.statusCode).toBe(401)

    const finalize = await app.inject({ method: 'POST', url: '/v1/media/1/finalize' })
    expect(finalize.statusCode).toBe(401)

    const get = await app.inject({ method: 'GET', url: '/v1/media/1' })
    expect(get.statusCode).toBe(401)
  })

  it('uploads a real image through a presigned URL and finalizes it', async () => {
    const { mediaId, uploadUrl } = await requestUploadUrl(accessToken, 'image/webp')
    await putToPresignedUrl(uploadUrl, TINY_WEBP, 'image/webp')

    const finalizeResponse = await app.inject({
      method: 'POST',
      url: `/v1/media/${mediaId}/finalize`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(finalizeResponse.statusCode).toBe(200)
    expect(finalizeResponse.json().data).toEqual({ id: mediaId, status: 'pending' })

    // No worker runs in this test process (matches timeline.integration.test.ts's
    // precedent for fan-out), so it stays pending — finalize's own
    // validation, not the transcode, is what's under test here.
    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/media/${mediaId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(getResponse.statusCode).toBe(200)
    expect(getResponse.json().data.status).toBe('pending')
  })

  it('rejects a Content-Type lie: bytes that are not actually an image', async () => {
    const { mediaId, uploadUrl } = await requestUploadUrl(accessToken, 'image/jpeg')
    await putToPresignedUrl(uploadUrl, Buffer.from('#!/bin/sh\necho not an image\n'), 'image/jpeg')

    const finalizeResponse = await app.inject({
      method: 'POST',
      url: `/v1/media/${mediaId}/finalize`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(finalizeResponse.statusCode).toBe(400)

    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/media/${mediaId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(getResponse.json().data.status).toBe('failed')
  })

  it('rejects a file over the 5 MB limit', async () => {
    const { mediaId, uploadUrl } = await requestUploadUrl(accessToken, 'image/webp')
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1)
    await putToPresignedUrl(uploadUrl, oversized, 'image/webp')

    const finalizeResponse = await app.inject({
      method: 'POST',
      url: `/v1/media/${mediaId}/finalize`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(finalizeResponse.statusCode).toBe(400)
  })

  it('rejects finalizing before anything has been uploaded', async () => {
    const { mediaId } = await requestUploadUrl(accessToken, 'image/webp')

    const finalizeResponse = await app.inject({
      method: 'POST',
      url: `/v1/media/${mediaId}/finalize`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(finalizeResponse.statusCode).toBe(400)
  })

  it("rejects finalizing someone else's media", async () => {
    const otherToken = await registerAndLogin('medianotowner')
    const { mediaId, uploadUrl } = await requestUploadUrl(accessToken, 'image/webp')
    await putToPresignedUrl(uploadUrl, TINY_WEBP, 'image/webp')

    const finalizeResponse = await app.inject({
      method: 'POST',
      url: `/v1/media/${mediaId}/finalize`,
      headers: { authorization: `Bearer ${otherToken}` },
    })
    expect(finalizeResponse.statusCode).toBe(403)
  })

  it('updates alt text for owned media', async () => {
    const { mediaId } = await requestUploadUrl(accessToken, 'image/webp')

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/media/${mediaId}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { altText: 'una captura de pantalla' },
    })

    expect(patchResponse.statusCode).toBe(200)
    expect(patchResponse.json().data.altText).toBe('una captura de pantalla')
  })

  it('returns 404 for media that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/media/999999999999999999',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(response.statusCode).toBe(404)
  })
})
