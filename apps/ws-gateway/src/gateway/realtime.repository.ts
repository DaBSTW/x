import type { Database } from '@x/db'
import { conversationMembers } from '@x/db'
import { and, eq } from 'drizzle-orm'

export type RealtimeRepository = ReturnType<typeof createRealtimeRepository>

/**
 * A trimmed read-only slice of what apps/api's own
 * `conversations.repository.ts` already knows how to check
 * (`findMember`) — duplicated rather than imported because apps/*
 * never import each other (CODESTYLE.md §7); both query the exact same
 * `(conversation_id, user_id)` primary key, so there's nothing to drift.
 */
export function createRealtimeRepository(db: Database) {
  return {
    async isConversationMember(conversationId: bigint, userId: bigint): Promise<boolean> {
      const [row] = await db
        .select({ userId: conversationMembers.userId })
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, userId),
          ),
        )
        .limit(1)
      return row !== undefined
    },
  }
}
