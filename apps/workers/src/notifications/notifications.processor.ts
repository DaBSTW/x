import type { NotificationJobData } from '@x/utils'
import { unreadCountKey } from '@x/utils'
import type { Redis } from 'ioredis'
import type { SendApnsPush } from './apns-sender.js'
import type { SendFcmPush } from './fcm-sender.js'
import type { NotificationsRepository } from './notifications.repository.js'
import type { SendPush } from './push-sender.js'
import { buildPushText } from './push-text.js'

export type NotificationsProcessorDeps = {
  repository: NotificationsRepository
  redis: Redis
  /** `undefined` when no VAPID keypair is configured — push is then skipped entirely (env.ts). */
  sendPush?: SendPush
  /** `undefined` when no FCM service account is configured — ROADMAP.md 2.9. */
  sendFcmPush?: SendFcmPush
  /** `undefined` when no APNs credentials are configured — ROADMAP.md 2.9. */
  sendApnsPush?: SendApnsPush
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
  const { repository, redis, sendPush, sendFcmPush, sendApnsPush } = deps

  async function sendPushForJob(userId: bigint, data: NotificationJobData): Promise<void> {
    // Cheap to check before either lookup below — neither is worth doing
    // at all when nothing on this server can act on the result (no
    // transport configured) or the recipient doesn't want this kind
    // pushed regardless of transport.
    if (!sendPush && !sendFcmPush && !sendApnsPush) return
    if (!(await repository.isPushEnabled(userId, data.kind))) return

    // Independent lookups (Web Push subscriptions vs. FCM/APNs device
    // tokens live in separate tables, ROADMAP.md 2.9) — run together
    // rather than one after the other.
    const [subscriptions, tokens] = await Promise.all([
      sendPush ? repository.findPushSubscriptions(userId) : Promise.resolve([]),
      sendFcmPush || sendApnsPush ? repository.findDeviceTokens(userId) : Promise.resolve([]),
    ])
    if (subscriptions.length === 0 && tokens.length === 0) return

    const actorUsername = data.actorId ? await repository.findUsername(BigInt(data.actorId)) : null
    const { title, body } = buildPushText(data.kind, actorUsername)
    const url = buildNotificationPath(data, actorUsername)
    const payload = { title, body, url }

    // A handful of devices per user at most across every transport — sent
    // concurrently rather than one round trip at a time.
    await Promise.all([
      ...subscriptions.map(async (subscription) => {
        if (!sendPush) return // narrowed already by the lookup above, but keeps TS happy without a `!`
        const result = await sendPush(subscription, payload)
        if (result.expired) await repository.deleteSubscriptionByEndpoint(subscription.endpoint)
      }),
      ...tokens.map(async (deviceToken) => {
        const sendToken = deviceToken.platform === 'fcm' ? sendFcmPush : sendApnsPush
        if (!sendToken) return // this token's platform isn't configured on this server — not "dead," just unreachable from here
        const result = await sendToken(deviceToken.token, payload)
        if (result.expired) await repository.deleteDeviceTokenByToken(deviceToken.token)
      }),
    ])
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
