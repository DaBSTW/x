import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, migrationsFolderUrl } from '@x/db'
import { RUM_INGEST_QUEUE_NAME, type RumIngestJobData } from '@x/utils'
import { Queue } from 'bullmq'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

describe('rum routes (roadmap 3.4g)', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let app: FastifyInstance
  let queue: Queue<RumIngestJobData>

  beforeAll(async () => {
    ;[postgresContainer, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ])

    const migrationDb = createDatabase(postgresContainer.getConnectionUri())
    await migrate(migrationDb, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    const env: Env = {
      NODE_ENV: 'test',
      API_PORT: 0,
      WEB_URL: 'http://localhost:3000',
      CORS_ORIGIN: 'http://localhost:3000',
      WORKER_ID: 11,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
      KAFKA_BROKERS: 'localhost:9092',
      JWT_ACCESS_TTL_MINUTES: 15,
      REFRESH_TOKEN_TTL_DAYS: 30,
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      MAIL_FROM: 'no-reply@x.example.com',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'x-media',
      S3_ACCESS_KEY_ID: 'x-minio',
      S3_SECRET_ACCESS_KEY: 'x-minio-secret',
      S3_FORCE_PATH_STYLE: true,
      OPENSEARCH_URL: 'http://localhost:9200',
    }
    app = await buildApp(env)

    // No apps/workers consumer runs in this test process (same posture as
    // notifications.integration.test.ts's own precedent for a queue whose
    // consumer lives in a different app) — reading the queue's own job
    // counts directly is what proves the route actually enqueued, not just
    // that it returned 204.
    queue = new Queue<RumIngestJobData>(RUM_INGEST_QUEUE_NAME, {
      connection: new Redis(redisContainer.getConnectionUrl(), { maxRetriesPerRequest: null }),
    })
  }, 120_000)

  afterAll(async () => {
    await queue.close()
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop()])
  })

  it('accepts a real LCP report without authentication and enqueues it for apps/workers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/rum',
      payload: {
        metric: 'LCP',
        value: 1800.5,
        rating: 'good',
        path: '/[username]',
        navigationType: 'navigate',
      },
    })

    expect(response.statusCode).toBe(204)

    const jobs = await queue.getJobs(['waiting', 'completed'])
    const lcpJob = jobs.find((job) => job.data.path === '/[username]')
    expect(lcpJob?.data).toMatchObject({
      metric: 'LCP',
      value: 1800.5,
      rating: 'good',
      path: '/[username]',
      navigationType: 'navigate',
    })
  })

  it('rejects an unknown metric name as a validation error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/rum',
      payload: {
        metric: 'BOGUS',
        value: 1,
        rating: 'good',
        path: '/',
        navigationType: 'navigate',
      },
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a missing body field as a validation error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/rum',
      payload: { metric: 'CLS', value: 0.05, rating: 'good', path: '/' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('rate-limits a flood from a single IP', async () => {
    const payload = {
      metric: 'TTFB' as const,
      value: 200,
      rating: 'good' as const,
      path: '/rate-limit-probe',
      navigationType: 'navigate',
    }

    // 120/min is this route's own limit — one over it must 429.
    let lastStatus = 0
    for (let i = 0; i < 121; i++) {
      const response = await app.inject({ method: 'POST', url: '/v1/rum', payload })
      lastStatus = response.statusCode
    }

    expect(lastStatus).toBe(429)
  })
})
