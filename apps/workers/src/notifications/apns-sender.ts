import { Notification, Provider } from '@parse/node-apn'
import { isApnsTokenDead } from './apns-token-errors.js'
import type { PushPayload, SendPushResult } from './push-sender.js'

export type SendApnsPush = (deviceToken: string, payload: PushPayload) => Promise<SendPushResult>

export type ApnsCredentials = {
  /** The P8 provider authentication key's contents (PEM), as issued by Apple — not a filesystem path. */
  key: string
  keyId: string
  teamId: string
  /** The app's bundle identifier — `node-apn` calls this the notification's `topic`. */
  bundleId: string
  /** false → APNs sandbox (development-signed builds); true → production. */
  production: boolean
}

/**
 * Real implementation over `@parse/node-apn`'s HTTP/2 provider —
 * ROADMAP.md 2.9's iOS half. Same injectable-function shape and the same
 * "never unit-tested directly" posture as fcm-sender.ts — see its own
 * comment on why; apns-token-errors.ts carries the real, tested logic on
 * this file's boundary instead.
 */
export function createApnsPushSender(credentials: ApnsCredentials): SendApnsPush {
  const provider = new Provider({
    token: { key: credentials.key, keyId: credentials.keyId, teamId: credentials.teamId },
    production: credentials.production,
  })

  return async (deviceToken, payload) => {
    const notification = new Notification()
    notification.topic = credentials.bundleId
    notification.alert = { title: payload.title, body: payload.body }
    notification.payload = { url: payload.url }

    const result = await provider.send(notification, deviceToken)
    // A single recipient was asked for, so at most one failure comes back.
    const failure = result.failed[0]
    if (!failure) return { expired: false }
    if (isApnsTokenDead(failure)) return { expired: true }
    // Best-effort, same posture as the web-push/FCM senders.
    console.error('APNs push send failed:', failure.response?.reason ?? failure.error)
    return { expired: false }
  }
}
