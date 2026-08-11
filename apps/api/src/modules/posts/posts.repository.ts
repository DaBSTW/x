import type { Database } from '@x/db'
import { type NewPost, type NewPostCounters, postCounters, postEntities, posts, users } from '@x/db'
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm'

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

export type PostRepository = ReturnType<typeof createPostsRepository>

export function createPostsRepository(db: Database) {
  return {
    async insertPost(
      post: NewPost,
      entities: PostEntityRow[],
      counters: NewPostCounters,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.insert(posts).values(post)
        await tx.insert(postCounters).values(counters)
        if (entities.length > 0) {
          await tx.insert(postEntities).values(entities)
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

    async softDeletePost(id: bigint): Promise<void> {
      await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, id))
    },

    /** Cursor pagination by Snowflake id — never OFFSET (CODESTYLE.md §13). */
    async listPostsByAuthor(authorId: bigint, limit: number, cursor: bigint | null) {
      const conditions = [eq(posts.authorId, authorId), isNull(posts.deletedAt)]
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
  }
}
