import webpush from 'web-push'

export type PushPayload = {
  title: string
  body: string
  /** Where a notificationclick in the service worker (apps/web/public/sw.js) should navigate. */
  url: string | null
}

export type PushSubscriptionTarget = {
  endpoint: string
  p256dh: string
  authKey: string
}

export type SendPushResult = {
  /** The browser revoked this subscription (uninstalled, storage cleared) — the caller should delete it. */
  expired: boolean
}

export type SendPush = (
  subscription: PushSubscriptionTarget,
  payload: PushPayload,
) => Promise<SendPushResult>

export type CreateWebPushSenderOptions = {
  publicKey: string
  privateKey: string
  subject: string
}

/**
 * Real implementation, wrapping the `web-push` library. Injectable
 * (`SendPush`) so notifications.worker.ts's tests never make a real network
 * call — the same pattern auth.service.ts uses for the HIBP check.
 */
export function createWebPushSender(options: CreateWebPushSenderOptions): SendPush {
  webpush.setVapidDetails(options.subject, options.publicKey, options.privateKey)

  return async (subscription, payload) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.authKey },
        },
        JSON.stringify(payload),
      )
      return { expired: false }
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        return { expired: true }
      }
      // Best-effort, matching apps/api/src/lib/mailer.ts: one subscriber's
      // delivery failure never fails the notification itself.
      console.error('web push send failed:', error)
      return { expired: false }
    }
  }
}
