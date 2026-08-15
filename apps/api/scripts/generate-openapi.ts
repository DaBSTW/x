import { writeFileSync } from 'node:fs'
import { buildApp } from '../src/app.js'
import type { Env } from '../src/env.js'

// Builds the app purely to extract its OpenAPI document — postgres.js and
// ioredis both connect lazily, so no real Postgres/Redis is needed just to
// read the swagger spec off the built instance.
const env: Env = {
  NODE_ENV: 'development',
  API_PORT: 0,
  WEB_URL: 'http://localhost:3000',
  CORS_ORIGIN: 'http://localhost:3000',
  WORKER_ID: 0,
  DATABASE_URL: 'postgres://x:x@localhost:5432/x',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_TTL_MINUTES: 15,
  REFRESH_TOKEN_TTL_DAYS: 30,
  SMTP_HOST: 'localhost',
  SMTP_PORT: 1025,
  MAIL_FROM: 'no-reply@x.example.com',
  // Unlike postgres.js/ioredis above, @opensearch-project/opensearch's
  // Client throws synchronously in its constructor without a `node` —
  // still never actually connected to just to read the swagger spec off
  // the built instance, same as every other placeholder value here.
  OPENSEARCH_URL: 'http://localhost:9200',
  // S3_* and KAFKA_BROKERS below are Env's own .default()'d fields (env.ts)
  // — z.infer makes a defaulted field's *output* type required even though
  // it's optional to *provide*, so this object needs every one of them
  // spelled out, same as the ones above. createS3Client (app.ts) and
  // createKafkaEventTopic (kafka-event-topic.ts) both connect lazily, same
  // "no real infra needed just to read the swagger spec" posture as
  // Postgres/Redis above — but unlike those two, both throw synchronously
  // on a missing/undefined option rather than deferring the failure to
  // first use, so leaving these out isn't a silent gap, it's a crash.
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'x-media',
  S3_ACCESS_KEY_ID: 'x-minio',
  S3_SECRET_ACCESS_KEY: 'x-minio-secret',
  S3_FORCE_PATH_STYLE: true,
  KAFKA_BROKERS: 'localhost:9092',
}

const app = await buildApp(env)
await app.ready()

const outputPath = new URL('../../../packages/sdk/openapi.json', import.meta.url)
writeFileSync(outputPath, JSON.stringify(app.swagger(), null, 2))

await app.close()

// biome-ignore lint/suspicious/noConsoleLog: script output, not a running service — CODESTYLE.md §8.1.
console.log(`OpenAPI spec written to ${outputPath.pathname}`)
process.exit(0)
