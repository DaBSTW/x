import { jitterTtlSeconds } from '@x/utils'
import type { Redis } from 'ioredis'

// SPECS.md §14.1's own "Caché negativa (60 s) para IDs inexistentes".
const NEGATIVE_CACHE_TTL_SECONDS = 60

export function notFoundKey(kind: string, id: string | bigint): string {
  return `notfound:${kind}:${id}`
}

/**
 * Marks `kind:id` as "confirmed nonexistent" for ~60s — a repeated lookup
 * of a deleted/never-existed id (a bad link shared around, a bot scanning
 * ids) short-circuits to the same 404 without a Postgres round trip each
 * time. Only ever call this for a genuine "doesn't exist" — never for a
 * *viewer-dependent* 404 (a blocked/protected/moderator-hidden post is 404
 * for some viewers and 200 for others; caching that here would incorrectly
 * 404 a viewer who should be able to see it, since this cache has no idea
 * who's asking).
 */
export async function markNotFound(redis: Redis, kind: string, id: string | bigint): Promise<void> {
  await redis.set(notFoundKey(kind, id), '1', 'EX', jitterTtlSeconds(NEGATIVE_CACHE_TTL_SECONDS))
}

/** `true` if `kind:id` was recently confirmed nonexistent — caller should return its own 404 directly, skipping the real lookup. */
export async function isMarkedNotFound(
  redis: Redis,
  kind: string,
  id: string | bigint,
): Promise<boolean> {
  return (await redis.exists(notFoundKey(kind, id))) === 1
}
