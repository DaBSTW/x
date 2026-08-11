import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  // How many followers a single fan-out job hydrates and pipelines per
  // Redis round trip — SPECS.md §6.1.
  FANOUT_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  NOTIFICATIONS_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  // Snowflake ID worker bits — this process generates notification ids, so
  // it needs its own value in a multi-instance deployment, same as apps/api
  // (see .env.example). @x/utils' generateId() reads this directly.
  WORKER_ID: z.coerce.number().int().min(0).max(1023).default(0),
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
