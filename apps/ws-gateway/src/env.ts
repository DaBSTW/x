import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WS_GATEWAY_PORT: z.coerce.number().int().positive().default(3002),
  // Checked against the WS upgrade request's Origin header before accepting
  // a connection — same posture as apps/api's CORS_ORIGIN, cheap to enforce
  // even though ticket-based auth (SPECS.md §8.1) already means a
  // cross-origin page can't forge a connection without the ticket itself.
  CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Heartbeat cadence (SPECS.md §8.3: ping/30s, timeout/60s) — configurable
  // so integration tests can use a millisecond-scale interval instead of
  // actually waiting a minute for a timeout to fire, same reasoning as
  // apps/api's LOGIN_RATE_LIMIT_MAX being overridable per test file.
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  // SPECS.md §8.3: "si la cola de escritura de un socket supera 1 MB, se
  // cierra la conexión."
  BACKPRESSURE_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),
})

export type Env = z.infer<typeof envSchema>

export class EnvValidationError extends Error {}

/**
 * Parses and validates process environment variables.
 *
 * @throws {EnvValidationError} If a required variable is missing or malformed
 * — the process should exit immediately on this, never serve a connection
 * with an incomplete configuration (CODESTYLE.md §8.4).
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
