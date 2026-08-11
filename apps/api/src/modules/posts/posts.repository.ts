import type { ProfilePostsFilter } from '@x/contracts'
import type { Database } from '@x/db'
import {
  type NewPost,
  type NewPostCounters,
  type Post,
  likes,
  media,
  postCounters,
  postEntities,
  posts,
  userCounters,
  users,
} from '@x/db'
import { MEDIA_STATUS, ValidationError } from '@x/utils'
import { and, desc, eq, exists, inArray, isNull, lt, ne, sql } from 'drizzle-orm'

export type PostEntityRow = {
  postId: bigint
  kind: number
  value: string
  startIndex: number
  endIndex: number
  refId: bigint | null
}

export type AuthorRow = {
  id: bigint
  username: string
  displayName: string
  avatarUrl: string | null
  isVerified: boolean
}

export type PostMediaRow = typeof media.$inferSelect

export type PostRepository = ReturnType<typeof createPostsRepository>

export function createPostsRepository(db: Database) {
  return {
    async insertPost(
      post: NewPost,
      entities: PostEntityRow[],
      counters: NewPostCounters,
      mediaIds: bigint[] = [],
    ): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.insert(posts).values(post)
        await tx.insert(postCounters).values(counters)
        if (entities.length > 0) {
          await tx.insert(postEntities).values(entities)
        }
        await tx
          .update(userCounters)
          .set({ postsCount: sql`${userCounters.postsCount} + 1` })
          .where(eq(userCounters.userId, post.authorId))

        if (mediaIds.length > 0) {
          // The WHERE clause is the actual validation: only rows the caller
          // owns, that finished processing, and that aren't already attached
          // elsewhere can match. If fewer rows matched than requested, some
          // id was invalid/foreign/not-ready/already-used — throwing here
          // rolls back the whole transaction, so no half-attached post exists.
          const attached = await tx
            .update(media)
            .set({ postId: post.id })
            .where(
              and(
                inArray(media.id, mediaIds),
                eq(media.ownerId, post.authorId),
                eq(media.status, MEDIA_STATUS.READY),
                isNull(media.postId),
              ),
            )
            .returning({ id: media.id })
          if (attached.length !== mediaIds.length) {
            throw new ValidationError(
              'one or more media attachments are invalid, not owned, not ready, or already attached to another post',
            )
          }
        }
      })
    },

    async findPostById(id: bigint) {
      const [post] = await db
        .select()
        .from(posts)
        .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
        .limit(1)
      return post ?? null
    },

    async findPostCounters(postId: bigint) {
      const [row] = await db
        .select()
        .from(postCounters)
        .where(eq(postCounters.postId, postId))
        .limit(1)
      return row ?? null
    },

    async findPostEntities(postId: bigint) {
      return db.select().from(postEntities).where(eq(postEntities.postId, postId))
    },

    async findEntitiesForPosts(postIds: bigint[]) {
      if (postIds.length === 0) return []
      return db.select().from(postEntities).where(inArray(postEntities.postId, postIds))
    },

    async findCountersForPosts(postIds: bigint[]) {
      if (postIds.length === 0) return []
      return db.select().from(postCounters).where(inArray(postCounters.postId, postIds))
    },

    async findMediaForPosts(postIds: bigint[]) {
      if (postIds.length === 0) return []
      return db.select().from(media).where(inArray(media.postId, postIds))
    },

    async findAuthorById(id: bigint): Promise<AuthorRow | null> {
      const [row] = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          isVerified: users.isVerified,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
      return row ?? null
    },

    /** Batch hydration for timeline reads — a single `WHERE id = ANY($1)` (SPECS.md §6.1), order is not guaranteed. */
    async findPostsByIds(ids: bigint[]) {
      if (ids.length === 0) return []
      return db
        .select()
        .from(posts)
        .where(and(inArray(posts.id, ids), isNull(posts.deletedAt)))
    },

    async findAuthorsByIds(ids: bigint[]): Promise<AuthorRow[]> {
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
        .where(inArray(users.id, ids))
    },

    /**
     * Walks `in_reply_to_id` one hop at a time up to the root, closest
     * ancestor last (caller reverses for root-first display). A loop of
     * single-row lookups rather than a recursive CTE — a real thread is
     * rarely more than a few dozen posts deep, and this keeps each hop
     * trivially testable against a fake repository, unlike a recursive
     * query a fake can't meaningfully stand in for. `seen` guards against
     * ever looping forever if a chain were somehow corrupted into a cycle.
     */
    async findAncestors(postId: bigint): Promise<Post[]> {
      const ancestors: Post[] = []
      const [start] = await db
        .select()
        .from(posts)
        .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
        .limit(1)
      let parentId = start?.inReplyToId ?? null
      const seen = new Set<string>()

      while (parentId !== null && !seen.has(parentId.toString())) {
        seen.add(parentId.toString())
        const [parent] = await db
          .select()
          .from(posts)
          .where(and(eq(posts.id, parentId), isNull(posts.deletedAt)))
          .limit(1)
        if (!parent) break
        ancestors.push(parent)
        parentId = parent.inReplyToId
      }
      return ancestors
    },

    /** Direct replies only (one level) — cursor-paginated by Snowflake id like every other list here. Backs both GET /posts/:id/thread's first page and GET /posts/:id/replies' "load more". */
    async findDirectReplies(postId: bigint, limit: number, cursor: bigint | null) {
      const conditions = [eq(posts.inReplyToId, postId), isNull(posts.deletedAt)]
      if (cursor !== null) conditions.push(lt(posts.id, cursor))
      return db
        .select()
        .from(posts)
        .where(and(...conditions))
        .orderBy(desc(posts.id))
        .limit(limit)
    },

    async findUserIdByUsername(usernameLower: string): Promise<bigint | null> {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.usernameLower, usernameLower))
        .limit(1)
      return row?.id ?? null
    },

    async findUserIdsByUsernames(usernamesLower: string[]): Promise<Map<string, bigint>> {
      if (usernamesLower.length === 0) return new Map()
      const rows = await db
        .select({ id: users.id, usernameLower: users.usernameLower })
        .from(users)
        .where(inArray(users.usernameLower, usernamesLower))
      return new Map(rows.map((row) => [row.usernameLower, row.id]))
    },

    async softDeletePost(id: bigint, authorId: bigint): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, id))
        await tx
          .update(userCounters)
          .set({ postsCount: sql`greatest(${userCounters.postsCount} - 1, 0)` })
          .where(eq(userCounters.userId, authorId))
      })
    },

    /**
     * Cursor pagination by Snowflake id — never OFFSET (CODESTYLE.md §13).
     * `filter` backs the profile page's Posts/Respuestas/Media tabs: replies
     * are `kind = 'reply'`, Posts is everything else, Media requires at
     * least one attached row (an `EXISTS`, not a join — a post can have up
     * to 4 media rows, and a join would need a `DISTINCT` to not duplicate
     * it).
     */
    async listPostsByAuthor(
      authorId: bigint,
      limit: number,
      cursor: bigint | null,
      filter: Exclude<ProfilePostsFilter, 'likes'> = 'posts',
    ) {
      const conditions = [eq(posts.authorId, authorId), isNull(posts.deletedAt)]
      if (filter === 'replies') {
        conditions.push(eq(posts.kind, 'reply'))
      } else if (filter === 'posts') {
        conditions.push(ne(posts.kind, 'reply'))
      } else {
        conditions.push(
          exists(db.select({ one: sql`1` }).from(media).where(eq(media.postId, posts.id))),
        )
      }
      if (cursor !== null) {
        conditions.push(lt(posts.id, cursor))
      }
      return db
        .select()
        .from(posts)
        .where(and(...conditions))
        .orderBy(desc(posts.id))
        .limit(limit)
    },

    /**
     * The profile page's "Me gusta" tab — posts *liked* by this user, not
     * authored by them, so it goes through `likes` instead of `author_id`.
     * Ordered by the post's own Snowflake id rather than when the like
     * happened: a deliberate simplification that reuses the exact same
     * cursor shape as every other list here, instead of a second keyset
     * over `(likes.created_at, post_id)` — see ROADMAP.md 1.6.
     */
    async listLikedPostsByUser(userId: bigint, limit: number, cursor: bigint | null) {
      const conditions = [
        isNull(posts.deletedAt),
        exists(
          db
            .select({ one: sql`1` })
            .from(likes)
            .where(and(eq(likes.userId, userId), eq(likes.postId, posts.id))),
        ),
      ]
      if (cursor !== null) {
        conditions.push(lt(posts.id, cursor))
      }
      return db
        .select()
        .from(posts)
        .where(and(...conditions))
        .orderBy(desc(posts.id))
        .limit(limit)
    },

    /** A repost is its own `posts` row: `kind = 'repost'`, `text` left `NULL` (SPECS.md §4.3). */
    async insertRepost(
      repost: { id: bigint; authorId: bigint; repostOfId: bigint; conversationId: bigint },
      counters: NewPostCounters,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.insert(posts).values({
          id: repost.id,
          authorId: repost.authorId,
          kind: 'repost',
          repostOfId: repost.repostOfId,
          conversationId: repost.conversationId,
        })
        await tx.insert(postCounters).values(counters)
        await tx
          .update(userCounters)
          .set({ postsCount: sql`${userCounters.postsCount} + 1` })
          .where(eq(userCounters.userId, repost.authorId))
      })
    },

    /** The requester's own active (non-deleted) repost of `repostOfId`, if any — at most one per (author, original post). */
    async findActiveRepost(authorId: bigint, repostOfId: bigint): Promise<bigint | null> {
      const [row] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(
            eq(posts.authorId, authorId),
            eq(posts.repostOfId, repostOfId),
            eq(posts.kind, 'repost'),
            isNull(posts.deletedAt),
          ),
        )
        .limit(1)
      return row?.id ?? null
    },

    /** Viewer-state hydration (SPECS.md §5.4's `viewer.reposted`) — which of these original posts the requester has an active repost of. */
    async findRepostedPostIds(authorId: bigint, repostOfIds: bigint[]): Promise<Set<bigint>> {
      if (repostOfIds.length === 0) return new Set()
      const rows = await db
        .select({ repostOfId: posts.repostOfId })
        .from(posts)
        .where(
          and(
            eq(posts.authorId, authorId),
            inArray(posts.repostOfId, repostOfIds),
            eq(posts.kind, 'repost'),
            isNull(posts.deletedAt),
          ),
        )
      return new Set(rows.map((row) => row.repostOfId).filter((id): id is bigint => id !== null))
    },
  }
}
