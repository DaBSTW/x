import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { type Database, type Media, createDatabase, media, migrationsFolderUrl, users } from '@x/db'
import { MEDIA_STATUS, createS3Client, generateId } from '@x/utils'
import { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { Redis } from 'ioredis'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMediaStorage } from '../lib/media-storage.js'
import { createMediaRepository } from './media.repository.js'
import { createMediaWorker } from './media.worker.js'

const S3_BUCKET = 'x-media'

/** A real ffmpeg subprocess, not a checked-in fixture — same reasoning as gif-transcoder.test.ts/video-transcoder.test.ts: this is exactly what the worker's own processGif/processVideo shells out to. */
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

describe('media worker', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let minioContainer: StartedMinioContainer
  let db: Database
  let s3Config: {
    endpoint: string
    region: string
    accessKeyId: string
    secretAccessKey: string
    forcePathStyle: boolean
  }

  async function insertOwner(): Promise<bigint> {
    const id = generateId()
    // varchar(15) — a short prefix plus the low digits of the Snowflake id
    // keeps every test user unique without hitting the limit.
    const username = `mo${id.toString().slice(-10)}`
    await db.insert(users).values({
      id,
      username,
      usernameLower: username.toLowerCase(),
      email: `${username}@example.com`,
      displayName: username,
    })
    return id
  }

  async function insertPendingMedia(
    ownerId: bigint,
    storageKey: string,
    mimeType: string,
    kind: Media['kind'] = 'image',
  ): Promise<bigint> {
    const id = generateId()
    await db.insert(media).values({ id, ownerId, storageKey, mimeType, sizeBytes: 1n, kind })
    return id
  }

  beforeAll(async () => {
    ;[postgresContainer, redisContainer, minioContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      new MinioContainer('minio/minio:latest').start(),
    ])

    db = createDatabase(postgresContainer.getConnectionUri())
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    s3Config = {
      endpoint: minioContainer.getConnectionUrl(),
      region: 'us-east-1',
      accessKeyId: minioContainer.getUsername(),
      secretAccessKey: minioContainer.getPassword(),
      forcePathStyle: true,
    }
    const s3Client = createS3Client(s3Config)
    await s3Client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }))
  }, 120_000)

  afterAll(async () => {
    await Promise.all([postgresContainer.stop(), redisContainer.stop(), minioContainer.stop()])
  })

  it('processes a queued job end-to-end: downloads, transcodes, uploads variants, marks ready', async () => {
    const ownerId = await insertOwner()
    const storageKey = 'media/e2e/original.png'
    const mediaId = await insertPendingMedia(ownerId, storageKey, 'image/png')

    const s3Client = createS3Client(s3Config)
    const sourceBuffer = await sharp({
      create: { width: 500, height: 300, channels: 3, background: '#663399' },
    })
      .png()
      .toBuffer()
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: storageKey,
        Body: sourceBuffer,
        ContentType: 'image/png',
      }),
    )

    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`
    const handle = createMediaWorker({
      repository: createMediaRepository(db),
      storage: createMediaStorage(s3Config),
      bucket: S3_BUCKET,
      redisUrl,
      concurrency: 1,
    })
    const queue = new Queue(handle.worker.name, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })

    const completed = new Promise<void>((resolve, reject) => {
      handle.worker.on('completed', (job) => {
        if (job.data.mediaId === mediaId.toString()) resolve()
      })
      handle.worker.on('failed', (_job, error) => reject(error))
    })
    await queue.add('process', { mediaId: mediaId.toString() })
    await completed

    const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1)
    expect(row?.status).toBe(MEDIA_STATUS.READY)
    expect(row?.width).toBe(500)
    expect(row?.height).toBe(300)
    expect(row?.blurhash).toBeTruthy()
    // 340 and 500 (source, since 600/1200 exceed it) × webp/avif.
    expect(row?.variants).toHaveLength(4)

    const firstVariant = row?.variants[0]
    expect(firstVariant).toBeDefined()
    if (firstVariant) {
      const object = await s3Client.send(
        new GetObjectCommand({ Bucket: S3_BUCKET, Key: firstVariant.key }),
      )
      expect(object.ContentLength).toBeGreaterThan(0)
    }

    await queue.close()
    await handle.close()
  }, 30_000)

  it('processes a queued GIF end-to-end: transcodes to mp4 + poster, uploads both, marks ready with duration (roadmap 2.7)', async () => {
    const ownerId = await insertOwner()
    const storageKey = 'media/e2e-gif/original.gif'
    const mediaId = await insertPendingMedia(ownerId, storageKey, 'image/gif', 'gif')

    const s3Client = createS3Client(s3Config)
    const gifBuffer = await ffmpegToBuffer(
      ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=48x48:rate=4'],
      'gif',
    )
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: storageKey,
        Body: gifBuffer,
        ContentType: 'image/gif',
      }),
    )

    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`
    const handle = createMediaWorker({
      repository: createMediaRepository(db),
      storage: createMediaStorage(s3Config),
      bucket: S3_BUCKET,
      redisUrl,
      concurrency: 1,
    })
    const queue = new Queue(handle.worker.name, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })

    const completed = new Promise<void>((resolve, reject) => {
      handle.worker.on('completed', (job) => {
        if (job.data.mediaId === mediaId.toString()) resolve()
      })
      handle.worker.on('failed', (_job, error) => reject(error))
    })
    await queue.add('process', { mediaId: mediaId.toString() })
    await completed

    const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1)
    expect(row?.status).toBe(MEDIA_STATUS.READY)
    expect(row?.width).toBe(48)
    expect(row?.height).toBe(48)
    expect(row?.durationMs).toBeGreaterThan(0)
    expect(row?.blurhash).toBeTruthy()
    expect(row?.variants.map((v) => v.format).sort()).toEqual(['mp4', 'poster'])

    const mp4Variant = row?.variants.find((v) => v.format === 'mp4')
    expect(mp4Variant).toBeDefined()
    if (mp4Variant) {
      const object = await s3Client.send(
        new GetObjectCommand({ Bucket: S3_BUCKET, Key: mp4Variant.key }),
      )
      expect(object.ContentLength).toBeGreaterThan(0)
    }

    await queue.close()
    await handle.close()
  }, 30_000)

  it('processes a queued video end-to-end: transcodes to an HLS ladder, uploads every file, marks ready (roadmap 2.7)', async () => {
    const ownerId = await insertOwner()
    const storageKey = 'media/e2e-video/original.mp4'
    const mediaId = await insertPendingMedia(ownerId, storageKey, 'video/mp4', 'video')

    const s3Client = createS3Client(s3Config)
    const videoBuffer = await ffmpegToBuffer(
      [
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=320x240:rate=10',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        '-movflags',
        'frag_keyframe+empty_moov',
      ],
      'mp4',
    )
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: storageKey,
        Body: videoBuffer,
        ContentType: 'video/mp4',
      }),
    )

    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`
    const handle = createMediaWorker({
      repository: createMediaRepository(db),
      storage: createMediaStorage(s3Config),
      bucket: S3_BUCKET,
      redisUrl,
      concurrency: 1,
    })
    const queue = new Queue(handle.worker.name, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })

    const completed = new Promise<void>((resolve, reject) => {
      handle.worker.on('completed', (job) => {
        if (job.data.mediaId === mediaId.toString()) resolve()
      })
      handle.worker.on('failed', (_job, error) => reject(error))
    })
    await queue.add('process', { mediaId: mediaId.toString() })
    await completed

    const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1)
    expect(row?.status).toBe(MEDIA_STATUS.READY)
    expect(row?.width).toBe(320)
    expect(row?.height).toBe(240)
    expect(row?.durationMs).toBeGreaterThan(0)
    expect(row?.blurhash).toBeTruthy()
    // 320x240 only clears the 240p rung.
    expect(row?.variants.map((v) => v.format).sort()).toEqual(['hls', 'hls-master', 'poster'])

    const masterVariant = row?.variants.find((v) => v.format === 'hls-master')
    expect(masterVariant).toBeDefined()
    if (masterVariant) {
      const object = await s3Client.send(
        new GetObjectCommand({ Bucket: S3_BUCKET, Key: masterVariant.key }),
      )
      const body = await object.Body?.transformToString()
      expect(body).toContain('#EXTM3U')
      expect(body).toContain('240p/playlist.m3u8')
    }

    await queue.close()
    await handle.close()
  }, 30_000)

  it('marks media failed once retries are exhausted for a genuinely broken object', async () => {
    const ownerId = await insertOwner()
    const storageKey = 'media/broken/original.png'
    const mediaId = await insertPendingMedia(ownerId, storageKey, 'image/png')
    // Deliberately never uploaded to MinIO — every attempt will fail to download it.

    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`
    const handle = createMediaWorker({
      repository: createMediaRepository(db),
      storage: createMediaStorage(s3Config),
      bucket: S3_BUCKET,
      redisUrl,
      concurrency: 1,
    })
    const queue = new Queue(handle.worker.name, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    })

    await queue.add(
      'process',
      { mediaId: mediaId.toString() },
      { attempts: 2, backoff: { type: 'fixed', delay: 50 } },
    )

    // media.worker.ts's markFailed() runs from inside a 'failed' listener
    // without blocking the emit — correct for production (nothing needs
    // nanosecond ordering between "BullMQ says failed" and "the row says
    // failed"), but it means the DB write can genuinely land a beat after
    // the event fires. Poll instead of asserting the instant the event does.
    const finalStatus = await waitForMediaStatus(db, mediaId, MEDIA_STATUS.FAILED)
    expect(finalStatus).toBe(MEDIA_STATUS.FAILED)

    await queue.close()
    await handle.close()
  }, 30_000)
})

async function waitForMediaStatus(
  db: Database,
  mediaId: bigint,
  expected: number,
  timeoutMs = 10_000,
): Promise<number | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1)
    if (row?.status === expected) return row.status
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1)
  return row?.status
}
