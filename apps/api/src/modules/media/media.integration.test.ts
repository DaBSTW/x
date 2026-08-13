import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CreateBucketCommand } from '@aws-sdk/client-s3'
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { type Database, createDatabase, migrationsFolderUrl, users } from '@x/db'
import { MEDIA_LIMITS, createS3Client } from '@x/utils'
import { eq } from 'drizzle-orm'
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

/** A real ffmpeg subprocess, not a checked-in fixture — same reasoning as apps/workers' own gif-transcoder.test.ts/video-transcoder.test.ts: real bytes, decoded by the real magic-byte/ffprobe checks finalize() itself runs, not a stand-in for either. */
function ffmpegToBuffer(args: string[], format: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', ...args, '-f', format, '-'])
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`ffmpeg exited with code ${String(code)}`))
    })
  })
}

describe('media routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let mailpitContainer: StartedTestContainer
  let minioContainer: StartedMinioContainer
  let app: FastifyInstance
  let accessToken: string
  let db: Database

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

  /** No public API mutates isVerified (an admin/moderation action, ROADMAP.md 2.7's own duration exception aside) — a direct DB write is the only way a test can reach this state, same as other tests in this repo reaching for `db` directly when there's no endpoint for the setup step itself. */
  async function verifyUser(username: string): Promise<void> {
    await db.update(users).set({ isVerified: true }).where(eq(users.usernameLower, username))
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

    db = createDatabase(postgresContainer.getConnectionUri())
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

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

  describe('gif uploads (roadmap 2.7)', () => {
    it('uploads a real GIF through a presigned URL and finalizes it', async () => {
      const gif = await ffmpegToBuffer(
        ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=32x32:rate=4'],
        'gif',
      )
      const { mediaId, uploadUrl } = await requestUploadUrl(accessToken, 'image/gif')
      await putToPresignedUrl(uploadUrl, gif, 'image/gif')

      const finalizeResponse = await app.inject({
        method: 'POST',
        url: `/v1/media/${mediaId}/finalize`,
        headers: { authorization: `Bearer ${accessToken}` },
      })
      expect(finalizeResponse.statusCode).toBe(200)

      const getResponse = await app.inject({
        method: 'GET',
        url: `/v1/media/${mediaId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      })
      expect(getResponse.json().data).toMatchObject({ kind: 'gif', status: 'pending' })
    })

    it('rejects bytes that are not actually a GIF', async () => {
      const { mediaId, uploadUrl } = await requestUploadUrl(accessToken, 'image/gif')
      await putToPresignedUrl(uploadUrl, Buffer.from('not a gif at all'), 'image/gif')

      const finalizeResponse = await app.inject({
        method: 'POST',
        url: `/v1/media/${mediaId}/finalize`,
        headers: { authorization: `Bearer ${accessToken}` },
      })
      expect(finalizeResponse.statusCode).toBe(400)
    })

    it('rejects a GIF over the 15 MB limit', async () => {
      const { mediaId, uploadUrl } = await requestUploadUrl(accessToken, 'image/gif')
      const oversized = Buffer.alloc(15 * 1024 * 1024 + 1)
      await putToPresignedUrl(uploadUrl, oversized, 'image/gif')

      const finalizeResponse = await app.inject({
        method: 'POST',
        url: `/v1/media/${mediaId}/finalize`,
        headers: { authorization: `Bearer ${accessToken}` },
      })
      expect(finalizeResponse.statusCode).toBe(400)
    })
  })

  describe('video uploads (roadmap 2.7)', () => {
    it('uploads a real short video through a presigned URL and finalizes it', async () => {
      const video = await ffmpegToBuffer(
        [
          '-f',
          'lavfi',
          '-i',
          'testsrc=duration=1:size=64x64:rate=5',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          'frag_keyframe+empty_moov',
        ],
        'mp4',
      )
      const { mediaId, uploadUrl } = await requestUploadUrl(accessToken, 'video/mp4')
      await putToPresignedUrl(uploadUrl, video, 'video/mp4')

      const finalizeResponse = await app.inject({
        method: 'POST',
        url: `/v1/media/${mediaId}/finalize`,
        headers: { authorization: `Bearer ${accessToken}` },
      })
      expect(finalizeResponse.statusCode).toBe(200)

      const getResponse = await app.inject({
        method: 'GET',
        url: `/v1/media/${mediaId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      })
      expect(getResponse.json().data).toMatchObject({ kind: 'video', status: 'pending' })
    })

    it('rejects bytes that are not actually a video', async () => {
      const { mediaId, uploadUrl } = await requestUploadUrl(accessToken, 'video/mp4')
      await putToPresignedUrl(uploadUrl, Buffer.from('not a video at all'), 'video/mp4')

      const finalizeResponse = await app.inject({
        method: 'POST',
        url: `/v1/media/${mediaId}/finalize`,
        headers: { authorization: `Bearer ${accessToken}` },
      })
      expect(finalizeResponse.statusCode).toBe(400)
    })

    it('rejects a video over the 512 MB limit', async () => {
      const { mediaId, uploadUrl } = await requestUploadUrl(accessToken, 'video/mp4')
      const oversized = Buffer.alloc(MEDIA_LIMITS.MAX_VIDEO_SIZE_BYTES + 1)
      await putToPresignedUrl(uploadUrl, oversized, 'video/mp4')

      const finalizeResponse = await app.inject({
        method: 'POST',
        url: `/v1/media/${mediaId}/finalize`,
        headers: { authorization: `Bearer ${accessToken}` },
      })
      expect(finalizeResponse.statusCode).toBe(400)
    }, 30_000)

    it('rejects a video whose real duration exceeds 140 s for a non-verified account, but allows it for a verified one (roadmap 2.7)', async () => {
      // 150 real seconds — over the 140 s regular budget, comfortably under
      // the 2 h verified one. Low framerate/resolution keeps this fast to
      // encode despite the long duration (a handful of hundred frames, not
      // real-time-paced).
      const mediumVideo = await ffmpegToBuffer(
        [
          '-f',
          'lavfi',
          '-i',
          'testsrc=duration=150:size=64x64:rate=2',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          'frag_keyframe+empty_moov',
        ],
        'mp4',
      )

      const regular = await requestUploadUrl(accessToken, 'video/mp4')
      await putToPresignedUrl(regular.uploadUrl, mediumVideo, 'video/mp4')
      const rejected = await app.inject({
        method: 'POST',
        url: `/v1/media/${regular.mediaId}/finalize`,
        headers: { authorization: `Bearer ${accessToken}` },
      })
      expect(rejected.statusCode).toBe(400)

      const verifiedToken = await registerAndLogin('mediaverified')
      await verifyUser('mediaverified')
      const verified = await requestUploadUrl(verifiedToken, 'video/mp4')
      await putToPresignedUrl(verified.uploadUrl, mediumVideo, 'video/mp4')
      const accepted = await app.inject({
        method: 'POST',
        url: `/v1/media/${verified.mediaId}/finalize`,
        headers: { authorization: `Bearer ${verifiedToken}` },
      })
      expect(accepted.statusCode).toBe(200)
    }, 30_000)
  })
})
