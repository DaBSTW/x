import type { Conversation, Database, Message } from '@x/db'
import { conversationMembers, conversations, messages, users } from '@x/db'
import { and, count, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm'

export type MemberRow = {
  conversationId: bigint
  id: bigint
  username: string
  displayName: string
  avatarUrl: string | null
  isVerified: boolean
}

export type ConversationsRepository = ReturnType<typeof createConversationsRepository>

export function createConversationsRepository(db: Database) {
  return {
    async insertConversation(conversation: {
      id: bigint
      isGroup: boolean
      name: string | null
      createdBy: bigint
    }): Promise<void> {
      await db.insert(conversations).values(conversation)
    },

    async insertMembers(conversationId: bigint, userIds: bigint[]): Promise<void> {
      await db
        .insert(conversationMembers)
        .values(userIds.map((userId) => ({ conversationId, userId })))
    },

    async findConversationById(id: bigint): Promise<Conversation | null> {
      const [row] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1)
      return row ?? null
    },

    async findMember(conversationId: bigint, userId: bigint) {
      const [row] = await db
        .select()
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, userId),
          ),
        )
        .limit(1)
      return row ?? null
    },

    /**
     * An existing 1:1 (non-group) conversation between exactly these two
     * users, if one exists — POST /conversations reuses it instead of
     * creating a duplicate thread every time the same pair messages again.
     */
    async find1to1Conversation(userAId: bigint, userBId: bigint): Promise<bigint | null> {
      const rows = await db
        .select({ conversationId: conversationMembers.conversationId })
        .from(conversationMembers)
        .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
        .where(
          and(
            eq(conversations.isGroup, false),
            inArray(conversationMembers.userId, [userAId, userBId]),
          ),
        )
        .groupBy(conversationMembers.conversationId)
        .having(sql`count(*) = 2`)
        .limit(1)
      return rows[0]?.conversationId ?? null
    },

    /** GET /conversations — newest-created first, cursor-paginated like every other list (CODESTYLE.md §13). */
    async listConversationsForUser(
      userId: bigint,
      limit: number,
      cursor: bigint | null,
    ): Promise<Array<Conversation & { lastReadId: bigint | null }>> {
      const conditions = [eq(conversationMembers.userId, userId)]
      if (cursor !== null) conditions.push(lt(conversations.id, cursor))

      return db
        .select({
          id: conversations.id,
          isGroup: conversations.isGroup,
          name: conversations.name,
          createdBy: conversations.createdBy,
          lastMessageAt: conversations.lastMessageAt,
          createdAt: conversations.createdAt,
          lastReadId: conversationMembers.lastReadId,
        })
        .from(conversationMembers)
        .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
        .where(and(...conditions))
        .orderBy(desc(conversations.id))
        .limit(limit)
    },

    /** Batch member hydration for a page of conversations — one query, not one per row. */
    async findMembersForConversations(conversationIds: bigint[]): Promise<MemberRow[]> {
      if (conversationIds.length === 0) return []
      return db
        .select({
          conversationId: conversationMembers.conversationId,
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          isVerified: users.isVerified,
        })
        .from(conversationMembers)
        .innerJoin(users, eq(users.id, conversationMembers.userId))
        .where(inArray(conversationMembers.conversationId, conversationIds))
    },

    /** Unread messages in `conversationId` after `afterId` (or all of them, if the member never read any), excluding the viewer's own. */
    async countUnread(
      conversationId: bigint,
      afterId: bigint | null,
      viewerId: bigint,
    ): Promise<number> {
      const conditions = [
        eq(messages.conversationId, conversationId),
        isNull(messages.deletedAt),
        ne(messages.senderId, viewerId),
      ]
      if (afterId !== null) conditions.push(gt(messages.id, afterId))

      const [row] = await db
        .select({ count: count() })
        .from(messages)
        .where(and(...conditions))
      return row?.count ?? 0
    },

    async insertMessage(message: {
      id: bigint
      conversationId: bigint
      senderId: bigint
      text: string
    }): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.insert(messages).values(message)
        await tx
          .update(conversations)
          .set({ lastMessageAt: new Date() })
          .where(eq(conversations.id, message.conversationId))
      })
    },

    /** GET /conversations/:id/messages — newest first, cursor-paginated. */
    async listMessages(
      conversationId: bigint,
      limit: number,
      cursor: bigint | null,
    ): Promise<Message[]> {
      const conditions = [eq(messages.conversationId, conversationId), isNull(messages.deletedAt)]
      if (cursor !== null) conditions.push(lt(messages.id, cursor))

      return db
        .select()
        .from(messages)
        .where(and(...conditions))
        .orderBy(desc(messages.id))
        .limit(limit)
    },

    async findLatestMessageId(conversationId: bigint): Promise<bigint | null> {
      const [row] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
        .orderBy(desc(messages.id))
        .limit(1)
      return row?.id ?? null
    },

    async updateLastRead(conversationId: bigint, userId: bigint, messageId: bigint): Promise<void> {
      await db
        .update(conversationMembers)
        .set({ lastReadId: messageId })
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, userId),
          ),
        )
    },

    async findDmPrivacy(userId: bigint): Promise<number | null> {
      const [row] = await db
        .select({ dmPrivacy: users.dmPrivacy })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
      return row?.dmPrivacy ?? null
    },

    async userExists(id: bigint): Promise<boolean> {
      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1)
      return row !== undefined
    },
  }
}
