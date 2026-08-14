import { z } from 'zod'

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3001),
    WEB_URL: z.string().url().default('http://localhost:3000'),
    CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
    WORKER_ID: z.coerce.number().int().min(0).max(1023).default(0),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    // PEM keys, single line with literal "\n" — required outside development,
    // where the process generates an ephemeral keypair instead (see jwt.ts).
    JWT_ACCESS_PRIVATE_KEY: z.string().optional(),
    JWT_ACCESS_PUBLIC_KEY: z.string().optional(),
    JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    MAIL_FROM: z.string().email().default('no-reply@x.example.com'),
    // Optional, same posture as VAPID_PUBLIC_KEY below (ROADMAP.md 2.9):
    // unset means mailer.ts sends through the SMTP settings above instead
    // (Mailpit locally, in every integration test and in e2e) rather than
    // requiring a live Resend account just to boot or run the test suite.
    RESEND_API_KEY: z.string().optional(),

    // Optional (app.ts falls back to SPECS.md §11.3's 10/5) rather than
    // .default()'d — a plain .default() would make every hand-built `Env`
    // object across the *.integration.test.ts files add these two fields
    // for no benefit to them. e2e/global-setup.ts raises both: every spec
    // file's logins there share one backend and IP, so the production-sane
    // ceiling is easy to hit by suite size alone, not by anything a single
    // test does wrong.
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
    FORGOT_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),

    // ROADMAP.md 3.3e / SPECS.md §12.3's new-account limit — optional,
    // same reasoning and same fix as LOGIN_RATE_LIMIT_MAX above: a test
    // file with one long-lived shared author reused across many `it`
    // blocks (posts.integration.test.ts) can accumulate more than 10
    // posts within a run that takes seconds, nowhere near the real 24h
    // window this is meant to bound — raised there, not disabled, same
    // "the production-sane ceiling is easy to hit by suite size alone"
    // posture LOGIN_RATE_LIMIT_MAX's own comment already documents.
    NEW_ACCOUNT_MAX_POSTS_PER_DAY: z.coerce.number().int().positive().optional(),

    // ROADMAP.md 3.3 / SPECS.md §12.1's preventive layer, "listas de
    // bloqueo" — comma-separated, optional same reasoning as the rate
    // limits above. Unset (the default everywhere but a real deployment)
    // means no term is ever blocked, not that the check is skipped —
    // there's nothing to hardcode here a real deployment wouldn't
    // configure for itself (SPECS.md never names an actual wordlist).
    BLOCKED_TERMS: z.string().optional(),

    // Web Push (ROADMAP.md 2.9) — optional, same reasoning as the rate
    // limits above: apps/api only ever reads the public half (it serves
    // GET /push/vapid-public-key so the browser can subscribe); signing
    // outgoing pushes with the private half happens in apps/workers.
    // Unset in development/test — push is then reported unconfigured
    // instead of failing to boot (CODESTYLE.md §8.4 vs. §8.3: nothing here
    // is required to *serve a request* the way the JWT keypair is).
    VAPID_PUBLIC_KEY: z.string().optional(),

    // Object storage (S3/MinIO) — ROADMAP.md 1.5. Defaults match docker-compose.yml's minio service.
    S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('x-media'),
    S3_ACCESS_KEY_ID: z.string().default('x-minio'),
    S3_SECRET_ACCESS_KEY: z.string().default('x-minio-secret'),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

    // Search (ROADMAP.md 2.3 / SPECS.md §10) — query-time only; apps/api
    // never writes to OpenSearch (apps/workers' search-indexer.worker.ts
    // owns that), so this is the only OpenSearch config this app needs.
    OPENSEARCH_URL: z.string().url().default('http://localhost:9200'),

    // Kafka/Redpanda (ROADMAP.md 3.1) — apps/api is a *producer* only here
    // (post.created, interaction.events; kafka-event-topic.ts), same
    // "always has a docker-compose.yml-matching default" posture as
    // OPENSEARCH_URL above. apps/workers' own KAFKA_BROKERS (env.ts there)
    // is the consumer side of the same two topics.
    KAFKA_BROKERS: z.string().default('localhost:9092'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return
    if (!env.JWT_ACCESS_PRIVATE_KEY || !env.JWT_ACCESS_PUBLIC_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'JWT_ACCESS_PRIVATE_KEY and JWT_ACCESS_PUBLIC_KEY are required outside development',
        path: ['JWT_ACCESS_PRIVATE_KEY'],
      })
    }
  })

export type Env = z.infer<typeof envSchema>

export class EnvValidationError extends Error {}

/**
 * Parses and validates process environment variables.
 *
 * @throws {EnvValidationError} If a required variable is missing or malformed
 * — the process should exit immediately on this, never serve a request with
 * an incomplete configuration (CODESTYLE.md §8.4).
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
