import type { Database } from '@x/db'
import { follows, posts, userCounters } from '@x/db'
import {
  CELEBRITY_FOLLOWER_THRESHOLD,
  TIMELINE_RETENTION_SIZE,
  TIMELINE_TTL_SECONDS,
  jitterTtlSeconds,
  timelineKey,
} from '@x/utils'
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { withReconstructionLock } from '../../lib/reconstruction-lock.js'

export type TimelineRepository = ReturnType<typeof createTimelineRepository>

/** `timelineKey`'s own ZSET can't itself distinguish "never reconstructed" from "reconstructed to genuinely empty" (an empty ZADD pipeline is a no-op, so a brand-new user with zero followed-authors' posts leaves no trace) — this sentinel closes that gap, same TTL as the ZSET it stands in for. */
function timelineEmptyKey(userId: bigint): string {
  return `timeline:empty:${userId}`
}

function timelineLockKey(userId: bigint): string {
  return `timeline:lock:${userId}`
}

export function createTimelineRepository(db: Database, redis: Redis) {
  /** `true` once fan-out (or a prior reconstruction, empty or not) has populated this key — distinguishes "cold" from "genuinely empty". */
  async function timelineExists(userId: bigint): Promise<boolean> {
    const [zsetExists, emptyMarked] = await Promise.all([
      redis.exists(timelineKey(userId)),
      redis.exists(timelineEmptyKey(userId)),
    ])
    return zsetExists === 1 || emptyMarked === 1
  }

  /** Newest-first page from the precomputed ZSET — SPECS.md §6.1's `ZREVRANGEBYSCORE`. */
  async function readPrecomputed(
    userId: bigint,
    limit: number,
    cursor: bigint | null,
  ): Promise<bigint[]> {
    const max = cursor !== null ? `(${cursor.toString()}` : '+inf'
    const members = await redis.zrevrangebyscore(
      timelineKey(userId),
      max,
      '-inf',
      'LIMIT',
      0,
      limit,
    )
    return members.map((member) => BigInt(member))
  }

  /**
   * Cold-start fallback (SPECS.md §6.1): rebuilds the last 7 days of
   * followed-author posts straight from Postgres and seeds the ZSET so
   * subsequent reads hit Redis again. Not itself stampede-safe — callers
   * needing that go through `reconstructFromPostgresLocked` below instead;
   * this stays the plain, unguarded version because the locked wrapper's
   * own fallback path (lock-holder never finishes in time) needs to be
   * able to call *something* that doesn't just recurse into the lock again.
   */
  async function reconstructFromPostgres(userId: bigint): Promise<bigint[]> {
    const rows = await db
      .select({ id: posts.id })
      .from(posts)
      .innerJoin(follows, eq(follows.followeeId, posts.authorId))
      .where(
        and(
          eq(follows.followerId, userId),
          isNull(posts.deletedAt),
          sql`${posts.createdAt} > now() - interval '7 days'`,
        ),
      )
      .orderBy(desc(posts.id))
      .limit(TIMELINE_RETENTION_SIZE)

    const ids = rows.map((row) => row.id)
    // SPECS.md §14.1's TTL jitter (±10%) — this and fan-out.processor.ts's
    // own (apps/workers) write the exact same key with the exact same base
    // TTL, so both need the jitter applied for it to actually spread out
    // expiry rather than only doing so for timelines that happen to go
    // through this specific, less-common cold-start path.
    const ttlSeconds = jitterTtlSeconds(TIMELINE_TTL_SECONDS)
    if (ids.length > 0) {
      const key = timelineKey(userId)
      const pipeline = redis.pipeline()
      for (const id of ids) {
        pipeline.zadd(key, id.toString(), id.toString())
      }
      pipeline.expire(key, ttlSeconds)
      await pipeline.exec()
    } else {
      // Confirmed empty — mark it so the next request (or a concurrent
      // waiter below) doesn't redo this same multi-join query just to
      // relearn "nothing here".
      await redis.set(timelineEmptyKey(userId), '1', 'EX', ttlSeconds)
    }
    return ids
  }

  /**
   * SPECS.md §14.1's anti-stampede reconstruction lock, applied to the one
   * genuinely expensive rebuild path in this module — every tab/device a
   * user has open can hit a newly-cold timeline within the same instant,
   * and without this they'd all redundantly run the same multi-join query.
   */
  async function reconstructFromPostgresLocked(userId: bigint): Promise<bigint[]> {
    return withReconstructionLock(
      redis,
      timelineLockKey(userId),
      () => reconstructFromPostgres(userId),
      async () =>
        (await timelineExists(userId))
          ? readPrecomputed(userId, TIMELINE_RETENTION_SIZE, null)
          : null,
    )
  }

  /** Fan-out on read for celebrity followees (SPECS.md §6.1) — typically under 50 accounts per user, so this join stays cheap. */
  async function listRecentFromCelebrityFollowees(
    userId: bigint,
    limit: number,
    cursor: bigint | null,
  ): Promise<bigint[]> {
    const conditions = [
      eq(follows.followerId, userId),
      gte(userCounters.followersCount, CELEBRITY_FOLLOWER_THRESHOLD),
      isNull(posts.deletedAt),
    ]
    if (cursor !== null) conditions.push(lt(posts.id, cursor))

    const rows = await db
      .select({ id: posts.id })
      .from(follows)
      .innerJoin(userCounters, eq(userCounters.userId, follows.followeeId))
      .innerJoin(posts, eq(posts.authorId, follows.followeeId))
      .where(and(...conditions))
      .orderBy(desc(posts.id))
      .limit(limit)

    return rows.map((row) => row.id)
  }

  return {
    timelineExists,
    readPrecomputed,
    reconstructFromPostgres,
    reconstructFromPostgresLocked,
    listRecentFromCelebrityFollowees,
  }
}
