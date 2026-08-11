import type { Database } from '@x/db'
import { bookmarks, likes } from '@x/db'
import { and, eq, inArray } from 'drizzle-orm'

export type InteractionsRepository = ReturnType<typeof createInteractionsRepository>

export function createInteractionsRepository(db: Database) {
  return {
    async findLike(userId: bigint, postId: bigint): Promise<boolean> {
      const [row] = await db
        .select({ userId: likes.userId })
        .from(likes)
        .where(and(eq(likes.userId, userId), eq(likes.postId, postId)))
        .limit(1)
      return row !== undefined
    },

    async insertLike(userId: bigint, postId: bigint): Promise<void> {
      await db.insert(likes).values({ userId, postId })
    },

    /** Returns whether a row actually existed to delete — the caller must only decrement the counter then. */
    async deleteLike(userId: bigint, postId: bigint): Promise<boolean> {
      const deleted = await db
        .delete(likes)
        .where(and(eq(likes.userId, userId), eq(likes.postId, postId)))
        .returning({ userId: likes.userId })
      return deleted.length > 0
    },

    async findBookmark(userId: bigint, postId: bigint): Promise<boolean> {
      const [row] = await db
        .select({ userId: bookmarks.userId })
        .from(bookmarks)
        .where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId)))
        .limit(1)
      return row !== undefined
    },

    async insertBookmark(userId: bigint, postId: bigint): Promise<void> {
      await db.insert(bookmarks).values({ userId, postId })
    },

    async deleteBookmark(userId: bigint, postId: bigint): Promise<boolean> {
      const deleted = await db
        .delete(bookmarks)
        .where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId)))
        .returning({ userId: bookmarks.userId })
      return deleted.length > 0
    },

    /** Viewer-state hydration for a page of posts (SPECS.md §5.4's `viewer` field) — one query per interaction type, not one per post. */
    async findLikedPostIds(userId: bigint, postIds: bigint[]): Promise<Set<bigint>> {
      if (postIds.length === 0) return new Set()
      const rows = await db
        .select({ postId: likes.postId })
        .from(likes)
        .where(and(eq(likes.userId, userId), inArray(likes.postId, postIds)))
      return new Set(rows.map((row) => row.postId))
    },

    async findBookmarkedPostIds(userId: bigint, postIds: bigint[]): Promise<Set<bigint>> {
      if (postIds.length === 0) return new Set()
      const rows = await db
        .select({ postId: bookmarks.postId })
        .from(bookmarks)
        .where(and(eq(bookmarks.userId, userId), inArray(bookmarks.postId, postIds)))
      return new Set(rows.map((row) => row.postId))
    },
  }
}
