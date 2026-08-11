import { RateLimitError } from '@x/utils'
import type { Redis } from 'ioredis'

// Atomic fixed-window counter (INCR + PEXPIRE on first hit). SPECS.md §5.5
// describes a token bucket for smoother limiting under bursts; a fixed
// window is the simpler correct choice for the single caller phase 0 has
// (login by IP) — revisit if a second caller needs burst tolerance.
const FIXED_WINDOW_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`

/** Throws {@link RateLimitError} once `key` exceeds `limit` hits within `windowMs`. */
export async function enforceRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const [count, ttlMs] = (await redis.eval(FIXED_WINDOW_SCRIPT, 1, key, windowMs)) as [
    number,
    number,
  ]

  if (count > limit) {
    const retryAfterSeconds = Math.ceil(Math.max(ttlMs, 0) / 1000)
    throw new RateLimitError('rate limit exceeded', retryAfterSeconds, { key, limit })
  }
}

const BACKOFF_BASE_SECONDS = 1
const BACKOFF_MAX_SECONDS = 300
const FAILURE_COUNT_TTL_SECONDS = 15 * 60

/**
 * Per-account exponential backoff on top of the per-IP rate limit — SPECS.md
 * §5.5 and §11.3. Independent of IP so a distributed attacker can't bypass it
 * by rotating source addresses.
 *
 * @throws {RateLimitError} If the account is still within its backoff window.
 */
export async function assertLoginNotBackedOff(redis: Redis, accountKey: string): Promise<void> {
  const blockedUntilRaw = await redis.get(blockedKey(accountKey))
  if (!blockedUntilRaw) return

  const remainingMs = Number(blockedUntilRaw) - Date.now()
  if (remainingMs > 0) {
    throw new RateLimitError(
      'account temporarily locked after repeated failed logins',
      Math.ceil(remainingMs / 1000),
      {
        accountKey,
      },
    )
  }
}

/** Records a failed login and extends the account's backoff window exponentially. */
export async function recordLoginFailure(redis: Redis, accountKey: string): Promise<void> {
  const failures = await redis.incr(failuresKey(accountKey))
  await redis.expire(failuresKey(accountKey), FAILURE_COUNT_TTL_SECONDS)

  const delaySeconds = Math.min(BACKOFF_BASE_SECONDS * 2 ** (failures - 1), BACKOFF_MAX_SECONDS)
  await redis.set(
    blockedKey(accountKey),
    String(Date.now() + delaySeconds * 1000),
    'PX',
    delaySeconds * 1000,
  )
}

/** Clears backoff state after a successful login. */
export async function clearLoginFailures(redis: Redis, accountKey: string): Promise<void> {
  await redis.del(failuresKey(accountKey), blockedKey(accountKey))
}

function failuresKey(accountKey: string): string {
  return `login:failures:${accountKey}`
}

function blockedKey(accountKey: string): string {
  return `login:blocked:${accountKey}`
}
