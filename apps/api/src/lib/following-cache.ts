import { jitterTtlSeconds } from '@x/utils'
import type { Redis } from 'ioredis'

// SPECS.md §6.1: the timeline read path needs "who does this user follow"
// fast and often — a Redis SET beats a join on every home-timeline read.
// TTL 1h per ROADMAP.md 1.2; re-follow/unfollow both refresh it.
const TTL_SECONDS = 60 * 60

function followingKey(userId: bigint): string {
  return `following:${userId}`
}

export async function addToFollowingCache(
  redis: Redis,
  followerId: bigint,
  followeeId: bigint,
): Promise<void> {
  await redis.sadd(followingKey(followerId), followeeId.toString())
  // SPECS.md §14.1's TTL jitter (±10%) — many accounts warming this cache
  // around the same time (a follow-back wave after a popular post, a mass
  // import) would otherwise all expire together and stampede the Postgres
  // fallback in isFollowingCached below at once.
  await redis.expire(followingKey(followerId), jitterTtlSeconds(TTL_SECONDS))
}

export async function removeFromFollowingCache(
  redis: Redis,
  followerId: bigint,
  followeeId: bigint,
): Promise<void> {
  await redis.srem(followingKey(followerId), followeeId.toString())
}

/** Returns `null` on a cache miss so the caller knows to fall back to Postgres, not "false". */
export async function isFollowingCached(
  redis: Redis,
  followerId: bigint,
  followeeId: bigint,
): Promise<boolean | null> {
  const exists = await redis.exists(followingKey(followerId))
  if (exists === 0) return null
  const isMember = await redis.sismember(followingKey(followerId), followeeId.toString())
  return isMember === 1
}
