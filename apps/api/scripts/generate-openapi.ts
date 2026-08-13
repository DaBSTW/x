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
}

const app = await buildApp(env)
await app.ready()

const outputPath = new URL('../../../packages/sdk/openapi.json', import.meta.url)
writeFileSync(outputPath, JSON.stringify(app.swagger(), null, 2))

await app.close()

// biome-ignore lint/suspicious/noConsoleLog: script output, not a running service — CODESTYLE.md §8.1.
console.log(`OpenAPI spec written to ${outputPath.pathname}`)
process.exit(0)
