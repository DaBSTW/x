import type { Database } from '@x/db'
import { follows, userCounters, users } from '@x/db'
import { and, desc, eq, isNull, lt, ne, sql } from 'drizzle-orm'

export type SocialGraphRepository = ReturnType<typeof createSocialGraphRepository>

export function createSocialGraphRepository(db: Database) {
  return {
    async findFollow(followerId: bigint, followeeId: bigint) {
      const [row] = await db
        .select()
        .from(follows)
        .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
        .limit(1)
      return row ?? null
    },

    /** Insert + counter increments happen together — a follow row without matching counters would corrupt profile stats. */
    async insertFollow(followerId: bigint, followeeId: bigint): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.insert(follows).values({ followerId, followeeId })
        await tx
          .update(userCounters)
          .set({ followingCount: sql`${userCounters.followingCount} + 1` })
          .where(eq(userCounters.userId, followerId))
        await tx
          .update(userCounters)
          .set({ followersCount: sql`${userCounters.followersCount} + 1` })
          .where(eq(userCounters.userId, followeeId))
      })
    },

    async deleteFollow(followerId: bigint, followeeId: bigint): Promise<void> {
      await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(follows)
          .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
          .returning({ followerId: follows.followerId })
        if (deleted.length === 0) return // idempotent: unfollowing a non-follow is a no-op, not a counter bug

        await tx
          .update(userCounters)
          .set({ followingCount: sql`greatest(${userCounters.followingCount} - 1, 0)` })
          .where(eq(userCounters.userId, followerId))
        await tx
          .update(userCounters)
          .set({ followersCount: sql`greatest(${userCounters.followersCount} - 1, 0)` })
          .where(eq(userCounters.userId, followeeId))
      })
    },

    async findUserIdByUsername(usernameLower: string): Promise<bigint | null> {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.usernameLower, usernameLower))
        .limit(1)
      return row?.id ?? null
    },

    async userExists(id: bigint): Promise<boolean> {
      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1)
      return row !== undefined
    },

    /** Cursor pagination on `created_at` (no OFFSET — CODESTYLE.md §13). */
    async listFollowers(followeeId: bigint, limit: number, cursor: Date | null) {
      const conditions = [eq(follows.followeeId, followeeId)]
      if (cursor) conditions.push(lt(follows.createdAt, cursor))

      return db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          isVerified: users.isVerified,
          followedAt: follows.createdAt,
        })
        .from(follows)
        .innerJoin(users, eq(users.id, follows.followerId))
        .where(and(...conditions))
        .orderBy(desc(follows.createdAt))
        .limit(limit)
    },

    async listFollowing(followerId: bigint, limit: number, cursor: Date | null) {
      const conditions = [eq(follows.followerId, followerId)]
      if (cursor) conditions.push(lt(follows.createdAt, cursor))

      return db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          isVerified: users.isVerified,
          followedAt: follows.createdAt,
        })
        .from(follows)
        .innerJoin(users, eq(users.id, follows.followeeId))
        .where(and(...conditions))
        .orderBy(desc(follows.createdAt))
        .limit(limit)
    },

    /**
     * "Who to follow": most-followed accounts the viewer doesn't already
     * follow. The left join keeps this a single query instead of an N+1 —
     * a NULL `follows.followerId` after the join means no matching follow
     * row exists for (viewer, candidate).
     */
    async findSuggestions(userId: bigint, limit: number) {
      return db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          isVerified: users.isVerified,
        })
        .from(users)
        .innerJoin(userCounters, eq(userCounters.userId, users.id))
        .leftJoin(follows, and(eq(follows.followerId, userId), eq(follows.followeeId, users.id)))
        .where(and(ne(users.id, userId), isNull(follows.followerId)))
        .orderBy(desc(userCounters.followersCount))
        .limit(limit)
    },
  }
}
