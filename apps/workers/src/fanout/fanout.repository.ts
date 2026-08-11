import type { Database } from '@x/db'
import { follows, userCounters } from '@x/db'
import { and, asc, eq, gt } from 'drizzle-orm'

export type FanoutRepository = ReturnType<typeof createFanoutRepository>

export function createFanoutRepository(db: Database) {
  return {
    /** `null` when the author has no counters row yet (shouldn't happen post-registration, but a missing row means zero followers, not an error). */
    async getFollowersCount(authorId: bigint): Promise<number> {
      const [row] = await db
        .select({ followersCount: userCounters.followersCount })
        .from(userCounters)
        .where(eq(userCounters.userId, authorId))
        .limit(1)
      return row?.followersCount ?? 0
    },

    /**
     * One page of follower ids, ordered by `follower_id` — a keyset cursor
     * (never OFFSET, CODESTYLE.md §13) so batches stay stable even as follows
     * are added or removed mid-run.
     */
    async listFollowerIdsBatch(
      followeeId: bigint,
      afterId: bigint | null,
      limit: number,
    ): Promise<bigint[]> {
      const conditions = [eq(follows.followeeId, followeeId)]
      if (afterId !== null) conditions.push(gt(follows.followerId, afterId))

      const rows = await db
        .select({ followerId: follows.followerId })
        .from(follows)
        .where(and(...conditions))
        .orderBy(asc(follows.followerId))
        .limit(limit)

      return rows.map((row) => row.followerId)
    },
  }
}
