import type { Database, List } from '@x/db'
import { listMembers, lists, posts, users } from '@x/db'
import { and, count, desc, eq, isNull, lt } from 'drizzle-orm'

export type ListPatch = Partial<Pick<List, 'name' | 'description' | 'isPrivate'>>

export type ListsRepository = ReturnType<typeof createListsRepository>

export function createListsRepository(db: Database) {
  return {
    async insertList(list: {
      id: bigint
      ownerId: bigint
      name: string
      description: string | null
      isPrivate: boolean
    }): Promise<void> {
      await db.insert(lists).values(list)
    },

    async findListById(id: bigint): Promise<List | null> {
      const [row] = await db.select().from(lists).where(eq(lists.id, id)).limit(1)
      return row ?? null
    },

    async updateList(id: bigint, patch: ListPatch): Promise<void> {
      await db.update(lists).set(patch).where(eq(lists.id, id))
    },

    /** `list_members` cascades on delete (schema FK) — no separate cleanup needed. */
    async deleteList(id: bigint): Promise<void> {
      await db.delete(lists).where(eq(lists.id, id))
    },

    async countMembers(listId: bigint): Promise<number> {
      const [row] = await db
        .select({ count: count() })
        .from(listMembers)
        .where(eq(listMembers.listId, listId))
      return row?.count ?? 0
    },

    async findMember(listId: bigint, userId: bigint): Promise<boolean> {
      const [row] = await db
        .select({ userId: listMembers.userId })
        .from(listMembers)
        .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId)))
        .limit(1)
      return row !== undefined
    },

    async insertMember(listId: bigint, userId: bigint): Promise<void> {
      await db.insert(listMembers).values({ listId, userId })
    },

    async deleteMember(listId: bigint, userId: bigint): Promise<void> {
      await db
        .delete(listMembers)
        .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId)))
    },

    async findUserIdByUsername(usernameLower: string): Promise<bigint | null> {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.usernameLower, usernameLower))
        .limit(1)
      return row?.id ?? null
    },

    /** GET /users/:username/lists — most recent first, mirrors listPostsByAuthor's cursor convention (ROADMAP.md 2.8). */
    async listByOwner(ownerId: bigint, limit: number, cursor: bigint | null): Promise<List[]> {
      const conditions = [eq(lists.ownerId, ownerId)]
      if (cursor !== null) conditions.push(lt(lists.id, cursor))
      return db
        .select()
        .from(lists)
        .where(and(...conditions))
        .orderBy(desc(lists.id))
        .limit(limit)
    },

    /** GET /timeline/list/:id (ROADMAP.md 2.8) — every current member's recent posts, cursor-paginated same as any other timeline source. */
    async findRecentPostsByMembers(
      listId: bigint,
      limit: number,
      cursor: bigint | null,
    ): Promise<bigint[]> {
      const conditions = [eq(listMembers.listId, listId), isNull(posts.deletedAt)]
      if (cursor !== null) conditions.push(lt(posts.id, cursor))

      const rows = await db
        .select({ id: posts.id })
        .from(listMembers)
        .innerJoin(posts, eq(posts.authorId, listMembers.userId))
        .where(and(...conditions))
        .orderBy(desc(posts.id))
        .limit(limit)
      return rows.map((row) => row.id)
    },
  }
}
