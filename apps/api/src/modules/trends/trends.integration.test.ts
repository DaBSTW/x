import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { createDatabase, migrationsFolderUrl, trendingTopics } from '@x/db'
import { GLOBAL_TREND_SCOPE, generateId } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Env } from '../../env.js'

describe('trends routes', () => {
  let postgresContainer: StartedPostgreSqlContainer
  let redisContainer: StartedRedisContainer
  let app: FastifyInstance

  beforeAll(async () => {
    ;[postgresContainer, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ])

    const migrationDb = createDatabase(postgresContainer.getConnectionUri())
    await migrate(migrationDb, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

    // apps/workers' compute-trends.ts is the only real writer — this test
    // seeds trending_topics directly to stand in for a completed run,
    // exactly the same posture as push.integration.test.ts seeding a
    // subscription row directly instead of driving a browser through it.
    await migrationDb.insert(trendingTopics).values([
      {
        id: generateId(),
        scope: GLOBAL_TREND_SCOPE,
        hashtag: 'mundial',
        score: 12.5,
        postCount1h: 200,
        uniqueAuthors1h: 80,
        computedAt: new Date(),
      },
      {
        id: generateId(),
        scope: GLOBAL_TREND_SCOPE,
        hashtag: 'elecciones',
        score: 4.2,
        postCount1h: 90,
        uniqueAuthors1h: 55,
        computedAt: new Date(),
      },
      {
        id: generateId(),
        scope: 'es',
        hashtag: 'seleccion',
        score: 9.1,
        postCount1h: 150,
        uniqueAuthors1h: 70,
        computedAt: new Date(),
      },
    ])

    const env: Env = {
      NODE_ENV: 'test',
      API_PORT: 0,
      WEB_URL: 'http://localhost:3000',
      CORS_ORIGIN: 'http://localhost:3000',
      WORKER_ID: 9,
      DATABASE_URL: postgresContainer.getConnectionUri(),
      REDIS_URL: redisContainer.getConnectionUrl(),
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
    }
    app = await buildApp(env)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await Promise.all([postgresContainer.stop(), redisContainer.stop()])
  })

  it('serves the global scope by default, highest score first, without authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/trends' })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([
      { hashtag: 'mundial', score: 12.5, postCount1h: 200, uniqueAuthors1h: 80 },
      { hashtag: 'elecciones', score: 4.2, postCount1h: 90, uniqueAuthors1h: 55 },
    ])
  })

  it('serves a language-scoped snapshot when lang is given', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/trends?lang=es' })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([
      { hashtag: 'seleccion', score: 9.1, postCount1h: 150, uniqueAuthors1h: 70 },
    ])
  })

  it('respects limit', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/trends?limit=1' })

    expect(response.json().data).toHaveLength(1)
  })

  it('returns an empty list, not a 404, for a language with no snapshot yet', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/trends?lang=de' })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([])
  })

  it('rejects a limit above 50 as a validation error', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/trends?limit=51' })

    expect(response.statusCode).toBe(400)
  })
})
