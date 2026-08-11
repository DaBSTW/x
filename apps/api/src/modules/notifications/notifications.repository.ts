import type { Database } from '@x/db'
import { notifications, users } from '@x/db'
import { and, count, desc, eq, isNull, lt, lte } from 'drizzle-orm'

export type NotificationRow = {
  id: bigint
  kind: (typeof notifications.kind.enumValues)[number]
  postId: bigint | null
  groupKey: string | null
  readAt: Date | null
  createdAt: Date
  actorId: bigint | null
  actorUsername: string | null
  actorDisplayName: string | null
  actorAvatarUrl: string | null
  actorIsVerified: boolean | null
}

export type NotificationsRepository = ReturnType<typeof createNotificationsRepository>

export function createNotificationsRepository(db: Database) {
  return {
    /** Cursor pagination by Snowflake id — never OFFSET (CODESTYLE.md §13). */
    async listForUser(
      userId: bigint,
      limit: number,
      cursor: bigint | null,
    ): Promise<NotificationRow[]> {
      const conditions = [eq(notifications.userId, userId)]
      if (cursor !== null) conditions.push(lt(notifications.id, cursor))

      return db
        .select({
          id: notifications.id,
          kind: notifications.kind,
          postId: notifications.postId,
          groupKey: notifications.groupKey,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
          actorId: users.id,
          actorUsername: users.username,
          actorDisplayName: users.displayName,
          actorAvatarUrl: users.avatarUrl,
          actorIsVerified: users.isVerified,
        })
        .from(notifications)
        .leftJoin(users, eq(users.id, notifications.actorId))
        .where(and(...conditions))
        .orderBy(desc(notifications.id))
        .limit(limit)
    },

    /** Marks unread notifications up to and including `cursor` as read; returns how many rows changed (to adjust the Redis unread count by exactly that much). */
    async markReadUpTo(userId: bigint, cursor: bigint): Promise<number> {
      const updated = await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, userId),
            lte(notifications.id, cursor),
            isNull(notifications.readAt),
          ),
        )
        .returning({ id: notifications.id })
      return updated.length
    },

    async countUnread(userId: bigint): Promise<number> {
      const [row] = await db
        .select({ count: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      return row?.count ?? 0
    },
  }
}
