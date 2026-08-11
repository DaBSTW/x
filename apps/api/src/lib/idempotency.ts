import { ConflictError } from '@x/utils'
import type { Redis } from 'ioredis'

const LOCK_TTL_SECONDS = 30

export type IdempotencyResult<T> = {
  result: T
  replayed: boolean
}

/**
 * Runs `fn` at most once per `key` within `ttlSeconds` — SPECS.md §5.1 /
 * CODESTYLE.md §12 ("toda escritura acepta Idempotency-Key"). A short-lived
 * lock (`SET NX`) closes the race where two requests with the same key
 * arrive concurrently; the loser gets a 409 telling it to retry, rather than
 * both re-running `fn`.
 */
export async function withIdempotency<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<IdempotencyResult<T>> {
  const cacheKey = `idempotency:${key}`
  const cached = await redis.get(cacheKey)
  if (cached !== null) {
    return { result: JSON.parse(cached) as T, replayed: true }
  }

  const lockKey = `idempotency:lock:${key}`
  const acquired = await redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
  if (acquired === null) {
    throw new ConflictError(
      'a request with this Idempotency-Key is already in flight, retry shortly',
    )
  }

  try {
    const result = await fn()
    await redis.set(cacheKey, JSON.stringify(result), 'EX', ttlSeconds)
    return { result, replayed: false }
  } finally {
    await redis.del(lockKey)
  }
}
