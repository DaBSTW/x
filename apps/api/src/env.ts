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

    // Optional (app.ts falls back to SPECS.md §11.3's 10/5) rather than
    // .default()'d — a plain .default() would make every hand-built `Env`
    // object across the *.integration.test.ts files add these two fields
    // for no benefit to them. e2e/global-setup.ts raises both: every spec
    // file's logins there share one backend and IP, so the production-sane
    // ceiling is easy to hit by suite size alone, not by anything a single
    // test does wrong.
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
    FORGOT_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),

    // Object storage (S3/MinIO) — ROADMAP.md 1.5. Defaults match docker-compose.yml's minio service.
    S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('x-media'),
    S3_ACCESS_KEY_ID: z.string().default('x-minio'),
    S3_SECRET_ACCESS_KEY: z.string().default('x-minio-secret'),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
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
