import type { NotificationJobData } from '@x/utils'
import { unreadCountKey } from '@x/utils'
import type { Redis } from 'ioredis'
import type { NotificationsRepository } from './notifications.repository.js'
import type { SendPush } from './push-sender.js'
import { buildPushText } from './push-text.js'

export type NotificationsProcessorDeps = {
  repository: NotificationsRepository
  redis: Redis
  /** `undefined` when no VAPID keypair is configured — push is then skipped entirely (env.ts). */
  sendPush?: SendPush
}

export type NotificationsProcessor = (data: NotificationJobData) => Promise<void>

/** Where tapping a push notification should go — mirrors apps/web/lib/notification-text.ts's notificationHref, but as a plain path (the service worker resolves it against its own origin). */
function buildNotificationPath(
  data: NotificationJobData,
  actorUsername: string | null,
): string | null {
  if (data.postId && actorUsername) return `/${actorUsername}/status/${data.postId}`
  if (actorUsername) return `/${actorUsername}`
  return null
}

export function createNotificationsProcessor(
  deps: NotificationsProcessorDeps,
): NotificationsProcessor {
  const { repository, redis, sendPush } = deps

  async function sendPushForJob(userId: bigint, data: NotificationJobData): Promise<void> {
    if (!sendPush) return
    if (!(await repository.isPushEnabled(userId, data.kind))) return

    const subscriptions = await repository.findPushSubscriptions(userId)
    if (subscriptions.length === 0) return

    const actorUsername = data.actorId ? await repository.findUsername(BigInt(data.actorId)) : null
    const { title, body } = buildPushText(data.kind, actorUsername)
    const url = buildNotificationPath(data, actorUsername)

    // A handful of devices per user at most — sent concurrently rather than
    // one round trip at a time.
    await Promise.all(
      subscriptions.map(async (subscription) => {
        const result = await sendPush(subscription, { title, body, url })
        if (result.expired) {
          await repository.deleteSubscriptionByEndpoint(subscription.endpoint)
        }
      }),
    )
  }

  return async function processNotificationJob(data: NotificationJobData): Promise<void> {
    const id = await repository.insertFromJob(data)
    if (id === null) return // blocked, muted, or an in_app preference turned off (ROADMAP.md 2.6/2.9) — nothing was inserted, nothing to count or push

    // Only bump an already-warm counter. A cold one is left alone —
    // apps/api's getUnreadCount() recomputes it from Postgres on next read,
    // which by then already includes the row just inserted above.
    const key = unreadCountKey(data.userId)
    if (await redis.exists(key)) {
      await redis.incr(key)
    }

    await sendPushForJob(BigInt(data.userId), data)
  }
}
