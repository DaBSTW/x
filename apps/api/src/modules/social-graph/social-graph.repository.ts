import type { Database } from '@x/db'
import { blocks, followRequests, follows, mutes, userCounters, users } from '@x/db'
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'

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

    /** `null` when the user doesn't exist — replaces a separate userExists lookup in follow(), which needs this same row anyway. */
    async findUserProtectionStatus(id: bigint): Promise<boolean | null> {
      const [row] = await db
        .select({ isProtected: users.isProtected })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
      return row ? row.isProtected : null
    },

    async findFollowRequest(requesterId: bigint, targetId: bigint) {
      const [row] = await db
        .select()
        .from(followRequests)
        .where(
          and(eq(followRequests.requesterId, requesterId), eq(followRequests.targetId, targetId)),
        )
        .limit(1)
      return row ?? null
    },

    async insertFollowRequest(requesterId: bigint, targetId: bigint): Promise<void> {
      await db.insert(followRequests).values({ requesterId, targetId })
    },

    /** Cancelling your own pending request and the target rejecting it are the same operation on the same row — `true` iff a row actually existed to delete. */
    async deleteFollowRequest(requesterId: bigint, targetId: bigint): Promise<boolean> {
      const deleted = await db
        .delete(followRequests)
        .where(
          and(eq(followRequests.requesterId, requesterId), eq(followRequests.targetId, targetId)),
        )
        .returning({ requesterId: followRequests.requesterId })
      return deleted.length > 0
    },

    /** Accepting: the pending row becomes a real follow, atomically — `false` when there was nothing pending to accept. */
    async acceptFollowRequest(requesterId: bigint, targetId: bigint): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx
          .delete(followRequests)
          .where(
            and(eq(followRequests.requesterId, requesterId), eq(followRequests.targetId, targetId)),
          )
          .returning({ requesterId: followRequests.requesterId })
        if (deleted.length === 0) return false

        await tx.insert(follows).values({ followerId: requesterId, followeeId: targetId })
        await tx
          .update(userCounters)
          .set({ followingCount: sql`${userCounters.followingCount} + 1` })
          .where(eq(userCounters.userId, requesterId))
        await tx
          .update(userCounters)
          .set({ followersCount: sql`${userCounters.followersCount} + 1` })
          .where(eq(userCounters.userId, targetId))
        return true
      })
    },

    /** Cursor pagination on `created_at`, same shape as listFollowers (CODESTYLE.md §13) — the row's `followedAt` field name (not "requestedAt") is deliberate: it lets social-graph.service.ts's toPage/FollowRow do the pagination math unmodified, the same cursor-shaped output either way. */
    async listFollowRequestsForTarget(targetId: bigint, limit: number, cursor: Date | null) {
      const conditions = [eq(followRequests.targetId, targetId)]
      if (cursor) conditions.push(lt(followRequests.createdAt, cursor))

      return db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          isVerified: users.isVerified,
          followedAt: followRequests.createdAt,
        })
        .from(followRequests)
        .innerJoin(users, eq(users.id, followRequests.requesterId))
        .where(and(...conditions))
        .orderBy(desc(followRequests.createdAt))
        .limit(limit)
    },

    async findBlock(blockerId: bigint, blockedId: bigint) {
      const [row] = await db
        .select()
        .from(blocks)
        .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
        .limit(1)
      return row ?? null
    },

    /**
     * Which of `authorIds` have a block with `viewerId`, in either direction
     * — ROADMAP.md 2.6. One batch query backs every read-path filter
     * (timeline, thread, profile posts) instead of an N+1 per post.
     */
    async findBlockedAuthorIds(viewerId: bigint, authorIds: bigint[]): Promise<Set<bigint>> {
      if (authorIds.length === 0) return new Set()
      const rows = await db
        .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
        .from(blocks)
        .where(
          or(
            and(eq(blocks.blockerId, viewerId), inArray(blocks.blockedId, authorIds)),
            and(eq(blocks.blockedId, viewerId), inArray(blocks.blockerId, authorIds)),
          ),
        )
      return new Set(
        rows.map((row) => (row.blockerId === viewerId ? row.blockedId : row.blockerId)),
      )
    },

    /**
     * A block is exclusive with following, in both directions — insert +
     * dropping any mutual follow (and its counters) happen together so a
     * block can never coexist with a stale follow row.
     */
    async insertBlock(blockerId: bigint, blockedId: bigint): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.insert(blocks).values({ blockerId, blockedId })

        const removed = await tx
          .delete(follows)
          .where(
            or(
              and(eq(follows.followerId, blockerId), eq(follows.followeeId, blockedId)),
              and(eq(follows.followerId, blockedId), eq(follows.followeeId, blockerId)),
            ),
          )
          .returning({ followerId: follows.followerId, followeeId: follows.followeeId })

        for (const follow of removed) {
          await tx
            .update(userCounters)
            .set({ followingCount: sql`greatest(${userCounters.followingCount} - 1, 0)` })
            .where(eq(userCounters.userId, follow.followerId))
          await tx
            .update(userCounters)
            .set({ followersCount: sql`greatest(${userCounters.followersCount} - 1, 0)` })
            .where(eq(userCounters.userId, follow.followeeId))
        }
      })
    },

    async deleteBlock(blockerId: bigint, blockedId: bigint): Promise<void> {
      await db
        .delete(blocks)
        .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
    },

    async findMute(muterId: bigint, mutedId: bigint) {
      const [row] = await db
        .select()
        .from(mutes)
        .where(and(eq(mutes.muterId, muterId), eq(mutes.mutedId, mutedId)))
        .limit(1)
      return row ?? null
    },

    async insertMute(muterId: bigint, mutedId: bigint): Promise<void> {
      await db.insert(mutes).values({ muterId, mutedId })
    },

    async deleteMute(muterId: bigint, mutedId: bigint): Promise<void> {
      await db.delete(mutes).where(and(eq(mutes.muterId, muterId), eq(mutes.mutedId, mutedId)))
    },

    /**
     * Which of `authorIds` the viewer has muted — ROADMAP.md 2.6. Unlike
     * `findBlockedAuthorIds`, unidirectional: muting is silent and one-way,
     * so only the viewer's own mutes can ever hide anything.
     */
    async findMutedAuthorIds(viewerId: bigint, authorIds: bigint[]): Promise<Set<bigint>> {
      if (authorIds.length === 0) return new Set()
      const rows = await db
        .select({ mutedId: mutes.mutedId })
        .from(mutes)
        .where(and(eq(mutes.muterId, viewerId), inArray(mutes.mutedId, authorIds)))
      return new Set(rows.map((row) => row.mutedId))
    },

    /**
     * Which of `authorIds` are protected accounts whose posts should be
     * hidden from `viewerId` (ROADMAP.md 2.6) — the author's own posts are
     * never hidden from themself, an approved follower's aren't either.
     * `undefined` `viewerId` (anonymous) hides every protected author in the
     * list outright: there's no possible follow relationship to check.
     */
    async findProtectedHiddenAuthorIds(
      viewerId: bigint | undefined,
      authorIds: bigint[],
    ): Promise<Set<bigint>> {
      if (authorIds.length === 0) return new Set()
      const conditions = [
        inArray(users.id, authorIds),
        eq(users.isProtected, true),
        isNull(follows.followerId),
      ]
      if (viewerId !== undefined) conditions.push(ne(users.id, viewerId))

      const rows = await db
        .select({ id: users.id })
        .from(users)
        .leftJoin(
          follows,
          viewerId !== undefined
            ? and(eq(follows.followeeId, users.id), eq(follows.followerId, viewerId))
            : sql`false`,
        )
        .where(and(...conditions))
      return new Set(rows.map((row) => row.id))
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
     * follow, and has no block relationship with in either direction
     * (ROADMAP.md 2.6 — suggesting someone unreachable would be a dead end).
     * Both left joins keep this a single query instead of an N+1 — a NULL
     * `followerId`/`blockerId` after the join means no matching row exists.
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
        .leftJoin(
          blocks,
          or(
            and(eq(blocks.blockerId, userId), eq(blocks.blockedId, users.id)),
            and(eq(blocks.blockerId, users.id), eq(blocks.blockedId, userId)),
          ),
        )
        .where(and(ne(users.id, userId), isNull(follows.followerId), isNull(blocks.blockerId)))
        .orderBy(desc(userCounters.followersCount))
        .limit(limit)
    },

    /** search.service.ts's "people" mode — hydrates a ranked list of ids from OpenSearch into real profile rows. Order is not guaranteed (same as posts.repository.ts's findPostsByIds); the caller re-sorts to match its own ranked id list. */
    async findManyByIds(ids: bigint[]) {
      if (ids.length === 0) return []
      return db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          isVerified: users.isVerified,
        })
        .from(users)
        .where(and(inArray(users.id, ids), isNull(users.deletedAt)))
    },

    /**
     * search.service.ts's "afinidad social" function_score signal
     * (SPECS.md §10.3) — capped, not the viewer's whole following list: a
     * function_score `terms` clause holding thousands of ids would bloat
     * every `top`-mode query for a viewer who follows a lot of accounts,
     * for a signal that's already just one of several inputs, not the
     * ranking on its own.
     */
    async findFolloweeIds(followerId: bigint, limit: number): Promise<bigint[]> {
      const rows = await db
        .select({ followeeId: follows.followeeId })
        .from(follows)
        .where(eq(follows.followerId, followerId))
        .orderBy(desc(follows.createdAt))
        .limit(limit)
      return rows.map((row) => row.followeeId)
    },
  }
}
