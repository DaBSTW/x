import type { Database } from '@x/db'
import { media, postCounters, posts, userCounters, users } from '@x/db'
import { and, inArray, isNull } from 'drizzle-orm'
import {
  type PostDocument,
  type UserDocument,
  buildPostDocument,
  buildUserDocument,
} from './document-builders.js'

export type SearchIndexerRepository = ReturnType<typeof createSearchIndexerRepository>

/**
 * Re-fetches the *current* Postgres state for a batch of touched ids and
 * assembles it into the exact shape the OpenSearch documents need — a
 * re-fetch, not a payload read, deliberately: a `post_counters`- or
 * `media`-only CDC event never touches `posts` itself, so trusting the CDC
 * message's own fields would leave `engagement`/`has_media` permanently
 * stale after the first index. This way every table that can affect a
 * document (search-indexer.worker.ts's CDC_TOPICS) converges on the same
 * "go read the source of truth again" path, with no per-table special case.
 * Same batched `WHERE id IN (...)` idiom as posts.repository.ts's
 * `findPostsByIds`/`findAuthorsByIds` (separate per-table queries assembled
 * in application code, not SQL joins) — id lists, never a join, because the
 * caller already deduplicates ids across a whole flush window.
 */
export function createSearchIndexerRepository(db: Database) {
  return {
    /** Omits any id from `ids` that's soft-deleted or gone — the caller's job to delete those from the index. */
    async fetchPostDocuments(ids: bigint[]): Promise<PostDocument[]> {
      if (ids.length === 0) return []
      const rows = await db
        .select()
        .from(posts)
        .where(and(inArray(posts.id, ids), isNull(posts.deletedAt)))
      if (rows.length === 0) return []

      const postIds = rows.map((row) => row.id)
      const authorIds = [...new Set(rows.map((row) => row.authorId))]
      const [authors, counters, mediaRows] = await Promise.all([
        // usernameLower, not username — buildPostDocument stores
        // author_handle lowercase either way (it lowercases defensively),
        // but selecting the column that's already canonical avoids a
        // redundant re-lowercase and says directly what this value is for.
        db
          .select({ id: users.id, usernameLower: users.usernameLower })
          .from(users)
          .where(inArray(users.id, authorIds)),
        db.select().from(postCounters).where(inArray(postCounters.postId, postIds)),
        db.select({ postId: media.postId }).from(media).where(inArray(media.postId, postIds)),
      ])
      const handleByAuthorId = new Map(authors.map((author) => [author.id, author.usernameLower]))
      const countersByPostId = new Map(counters.map((row) => [row.postId, row]))
      const postIdsWithMedia = new Set(
        mediaRows.map((row) => row.postId).filter((postId): postId is bigint => postId !== null),
      )

      return rows.map((row) =>
        buildPostDocument({
          id: row.id,
          authorId: row.authorId,
          authorHandle: handleByAuthorId.get(row.authorId) ?? '',
          text: row.text,
          lang: row.lang,
          isSensitive: row.isSensitive,
          hasMedia: postIdsWithMedia.has(row.id),
          createdAt: row.createdAt,
          counters: countersByPostId.get(row.id) ?? null,
        }),
      )
    },

    /** Omits any id from `ids` that's soft-deleted or gone — the caller's job to delete those from the index. */
    async fetchUserDocuments(ids: bigint[]): Promise<UserDocument[]> {
      if (ids.length === 0) return []
      const rows = await db
        .select()
        .from(users)
        .where(and(inArray(users.id, ids), isNull(users.deletedAt)))
      if (rows.length === 0) return []

      const userIds = rows.map((row) => row.id)
      const counters = await db
        .select()
        .from(userCounters)
        .where(inArray(userCounters.userId, userIds))
      const countersByUserId = new Map(counters.map((row) => [row.userId, row]))

      return rows.map((row) =>
        buildUserDocument({
          id: row.id,
          username: row.username,
          displayName: row.displayName,
          isVerified: row.isVerified,
          followersCount: countersByUserId.get(row.id)?.followersCount ?? null,
        }),
      )
    },
  }
}
