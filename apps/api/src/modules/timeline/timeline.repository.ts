import type { Database } from '@x/db'
import { follows, posts, userCounters } from '@x/db'
import {
  CELEBRITY_FOLLOWER_THRESHOLD,
  TIMELINE_RETENTION_SIZE,
  TIMELINE_TTL_SECONDS,
  timelineKey,
} from '@x/utils'
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import type { Redis } from 'ioredis'

export type TimelineRepository = ReturnType<typeof createTimelineRepository>

export function createTimelineRepository(db: Database, redis: Redis) {
  return {
    /** `true` once fan-out (or a prior reconstruction) has populated this key — distinguishes "cold" from "genuinely empty". */
    async timelineExists(userId: bigint): Promise<boolean> {
      return (await redis.exists(timelineKey(userId))) === 1
    },

    /** Newest-first page from the precomputed ZSET — SPECS.md §6.1's `ZREVRANGEBYSCORE`. */
    async readPrecomputed(userId: bigint, limit: number, cursor: bigint | null): Promise<bigint[]> {
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
    },

    /**
     * Cold-start fallback (SPECS.md §6.1): rebuilds the last 7 days of
     * followed-author posts straight from Postgres and seeds the ZSET so
     * subsequent reads hit Redis again.
     */
    async reconstructFromPostgres(userId: bigint): Promise<bigint[]> {
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
      if (ids.length > 0) {
        const key = timelineKey(userId)
        const pipeline = redis.pipeline()
        for (const id of ids) {
          pipeline.zadd(key, id.toString(), id.toString())
        }
        pipeline.expire(key, TIMELINE_TTL_SECONDS)
        await pipeline.exec()
      }
      return ids
    },

    /** Fan-out on read for celebrity followees (SPECS.md §6.1) — typically under 50 accounts per user, so this join stays cheap. */
    async listRecentFromCelebrityFollowees(
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
    },
  }
}
