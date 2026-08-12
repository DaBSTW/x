import type { Notification, NotificationPreference } from '@x/contracts'
import { CONFIGURABLE_NOTIFICATION_KINDS, defaultChannelEnabled, unreadCountKey } from '@x/utils'
import type { Redis } from 'ioredis'
import type { NotificationRow, NotificationsRepository } from './notifications.repository.js'

export type NotificationsService = ReturnType<typeof createNotificationsService>

export function createNotificationsService(repository: NotificationsRepository, redis: Redis) {
  async function list(
    userId: bigint,
    limit: number,
    cursor: bigint | null,
  ): Promise<{ items: Notification[]; hasMore: boolean }> {
    const rows = await repository.listForUser(userId, limit + 1, cursor)
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    return { items: page.map(toNotificationDto), hasMore }
  }

  /** Marks unread notifications up to `cursor` as read, then adjusts the Redis unread count by exactly what changed — never a blind reset. */
  async function markRead(userId: bigint, cursor: bigint): Promise<void> {
    const changed = await repository.markReadUpTo(userId, cursor)
    if (changed === 0) return

    const key = unreadCountKey(userId)
    if (await redis.exists(key)) {
      await redis.decrby(key, changed)
    } else {
      // Cold: countUnread() runs after the update above, so it already
      // reflects the post-markRead state — seed with it directly instead
      // of guessing a prior value to subtract from.
      await redis.set(key, await repository.countUnread(userId))
    }
  }

  async function getUnreadCount(userId: bigint): Promise<number> {
    const key = unreadCountKey(userId)
    const cached = await redis.get(key)
    if (cached !== null) return Math.max(0, Number(cached))

    const real = await repository.countUnread(userId)
    await redis.set(key, real)
    return real
  }

  /** Full type×channel matrix (CONFIGURABLE_NOTIFICATION_KINDS × {in_app, push}), overrides layered onto @x/utils' shared defaults — the caller never has to know which rows exist in Postgres and which don't. */
  async function getPreferences(userId: bigint): Promise<NotificationPreference[]> {
    const overrides = await repository.listPreferenceOverrides(userId)
    const overrideFor = new Map(overrides.map((row) => [`${row.kind}:${row.channel}`, row.enabled]))

    return CONFIGURABLE_NOTIFICATION_KINDS.flatMap((kind) =>
      (['in_app', 'push'] as const).map((channel) => ({
        kind,
        channel,
        enabled: overrideFor.get(`${kind}:${channel}`) ?? defaultChannelEnabled(kind, channel),
      })),
    )
  }

  async function updatePreference(userId: bigint, input: NotificationPreference): Promise<void> {
    await repository.setPreference(userId, input.kind, input.channel, input.enabled)
  }

  return { list, markRead, getUnreadCount, getPreferences, updatePreference }
}

function toNotificationDto(row: NotificationRow): Notification {
  return {
    id: row.id.toString(),
    kind: row.kind,
    actor:
      row.actorId === null
        ? null
        : {
            id: row.actorId.toString(),
            username: row.actorUsername ?? '',
            displayName: row.actorDisplayName ?? '',
            avatarUrl: row.actorAvatarUrl,
            isVerified: row.actorIsVerified ?? false,
          },
    postId: row.postId?.toString() ?? null,
    groupKey: row.groupKey,
    isRead: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  }
}
