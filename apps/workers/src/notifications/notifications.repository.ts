import type { Database } from '@x/db'
import { blocks, mutes, notifications } from '@x/db'
import { type NotificationJobData, generateId } from '@x/utils'
import { and, eq, or } from 'drizzle-orm'

export type NotificationsRepository = ReturnType<typeof createNotificationsRepository>

export function createNotificationsRepository(db: Database) {
  /** SPECS.md §13.1 step 1: never generate a notification across an active block (either direction), or into a mute the recipient set on the actor. `null` actor (system notifications) always delivers. */
  async function isSuppressed(userId: bigint, actorId: bigint | null): Promise<boolean> {
    if (actorId === null) return false

    const [blocked] = await db
      .select({ id: blocks.blockerId })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, userId), eq(blocks.blockedId, actorId)),
          and(eq(blocks.blockerId, actorId), eq(blocks.blockedId, userId)),
        ),
      )
      .limit(1)
    if (blocked) return true

    const [muted] = await db
      .select({ id: mutes.muterId })
      .from(mutes)
      .where(and(eq(mutes.muterId, userId), eq(mutes.mutedId, actorId)))
      .limit(1)
    return muted !== undefined
  }

  return {
    /** `null` return (instead of the new row's id) means the job was suppressed — ROADMAP.md 2.6 — and the caller shouldn't bump the recipient's unread count either. */
    async insertFromJob(data: NotificationJobData): Promise<bigint | null> {
      const userId = BigInt(data.userId)
      const actorId = data.actorId ? BigInt(data.actorId) : null
      if (await isSuppressed(userId, actorId)) return null

      const id = generateId()
      await db.insert(notifications).values({
        id,
        userId,
        kind: data.kind,
        actorId,
        postId: data.postId ? BigInt(data.postId) : null,
        groupKey: data.groupKey,
      })
      return id
    },
  }
}
