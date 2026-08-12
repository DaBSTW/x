import type { Database } from '@x/db'
import {
  blocks,
  mutes,
  notificationPreferences,
  notifications,
  pushSubscriptions,
  users,
} from '@x/db'
import {
  type ConfigurableNotificationKind,
  type NotificationJobData,
  defaultChannelEnabled,
  generateId,
} from '@x/utils'
import { and, eq, or } from 'drizzle-orm'

export type PushSubscriptionRow = {
  endpoint: string
  p256dh: string
  authKey: string
}

export type NotificationsRepository = ReturnType<typeof createNotificationsRepository>

export function createNotificationsRepository(db: Database) {
  /** SPECS.md §13.1 step 1: never generate a notification across an active block (either direction), or into a mute the recipient set on the actor. `null` actor (system notifications) always delivers. */
  async function isBlockedOrMuted(userId: bigint, actorId: bigint | null): Promise<boolean> {
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

  /** SPECS.md §13.1 step 1's other half: "Comprueba preferencias del receptor" — a kind the recipient turned off for in_app never gets a row at all, same as a block. `system` is never checked (not configurable — notifications.ts's CONFIGURABLE_NOTIFICATION_KINDS excludes it). */
  async function isChannelEnabled(
    userId: bigint,
    kind: ConfigurableNotificationKind,
    channel: 'in_app' | 'push',
  ): Promise<boolean> {
    const [override] = await db
      .select({ enabled: notificationPreferences.enabled })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.kind, kind),
          eq(notificationPreferences.channel, channel),
        ),
      )
      .limit(1)
    return override ? override.enabled : defaultChannelEnabled(kind, channel)
  }

  return {
    /** `null` return (instead of the new row's id) means the job was suppressed (block/mute, ROADMAP.md 2.6, or an in_app preference the recipient turned off) — the caller shouldn't bump the recipient's unread count, or push, either. */
    async insertFromJob(data: NotificationJobData): Promise<bigint | null> {
      const userId = BigInt(data.userId)
      const actorId = data.actorId ? BigInt(data.actorId) : null
      if (await isBlockedOrMuted(userId, actorId)) return null
      if (data.kind !== 'system' && !(await isChannelEnabled(userId, data.kind, 'in_app'))) {
        return null
      }

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

    /** Whether to *also* push for this insert — independent of (and checked after) the in_app decision above. */
    async isPushEnabled(userId: bigint, kind: NotificationJobData['kind']): Promise<boolean> {
      if (kind === 'system') return false // no device token to target meaningfully, and not configurable anyway
      return isChannelEnabled(userId, kind, 'push')
    },

    async findPushSubscriptions(userId: bigint): Promise<PushSubscriptionRow[]> {
      return db
        .select({
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          authKey: pushSubscriptions.authKey,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
    },

    /** Cleanup after web-push reports a subscription as expired (404/410) — the browser revoked it, so keeping it around would just fail again next time. */
    async deleteSubscriptionByEndpoint(endpoint: string): Promise<void> {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
    },

    async findUsername(userId: bigint): Promise<string | null> {
      const [row] = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
      return row?.username ?? null
    },
  }
}
