import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  // How many followers a single fan-out job hydrates and pipelines per
  // Redis round trip — SPECS.md §6.1.
  FANOUT_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  NOTIFICATIONS_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  // Mostly-I/O like fan-out/notifications above, not CPU-bound like media —
  // default matches those two, not media's lower one.
  TREND_INGEST_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  // Lower than the others by default: sharp's transcoding is CPU-bound per
  // job, unlike fan-out/notifications' mostly-I/O work — ROADMAP.md 1.5.
  MEDIA_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // Object storage (S3/MinIO) — same defaults as apps/api's env.ts, matching docker-compose.yml's minio service.
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('x-media'),
  S3_ACCESS_KEY_ID: z.string().default('x-minio'),
  S3_SECRET_ACCESS_KEY: z.string().default('x-minio-secret'),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  // Snowflake ID worker bits — this process generates notification ids, so
  // it needs its own value in a multi-instance deployment, same as apps/api
  // (see .env.example). @x/utils' generateId() reads this directly.
  WORKER_ID: z.coerce.number().int().min(0).max(1023).default(0),

  // Web Push (ROADMAP.md 2.9) — all three optional together: unset means
  // "push disabled," not a boot failure (CODESTYLE.md §8.3/§8.4 — nothing
  // else in this process depends on push actually working). The public key
  // must match whatever apps/api's VAPID_PUBLIC_KEY handed the browser, or
  // every send fails with a signature mismatch.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:security@x.example.com'),

  // ClickHouse (ROADMAP.md 2.4) — analytics-only, so unlike DATABASE_URL/
  // REDIS_URL this isn't allowed to be empty but every field still has a
  // docker-compose.yml-matching default, same posture as S3_* above: no
  // reason to force every dev to configure a fourth datastore by hand.
  CLICKHOUSE_URL: z.string().url().default('http://localhost:8123'),
  CLICKHOUSE_USER: z.string().default('x'),
  CLICKHOUSE_PASSWORD: z.string().default('x'),
  CLICKHOUSE_DATABASE: z.string().default('x_analytics'),

  // scripts/compute-trends.ts (ROADMAP.md 2.4 / SPECS.md §10.4's antispam
  // gate). Comma-separated, case-insensitive, matched without the leading
  // '#'. An env var rather than a DB table with no UI to manage it
  // (apps/admin is Phase 3) — this at least changes with a restart, not a
  // redeploy, and a hand-edited DB row would need the same manual
  // intervention anyway.
  TRENDS_BLACKLIST_HASHTAGS: z.string().default(''),

  // Search (ROADMAP.md 2.3 / SPECS.md §10) — same "always has a
  // docker-compose.yml-matching default" posture as CLICKHOUSE_* above.
  OPENSEARCH_URL: z.string().url().default('http://localhost:9200'),
})

export type Env = z.infer<typeof envSchema>

export class EnvValidationError extends Error {}

/**
 * Parses and validates process environment variables.
 *
 * @throws {EnvValidationError} If a required variable is missing or malformed
 * — the process should exit immediately on this, never run a worker with an
 * incomplete configuration (CODESTYLE.md §8.4).
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new EnvValidationError(`Invalid environment configuration — ${details}`)
  }
  return result.data
}
