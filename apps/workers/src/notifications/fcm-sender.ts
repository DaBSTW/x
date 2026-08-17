import { EXTERNAL_CALL_TIMEOUT_MS, withTimeout } from '@x/utils'
import { cert, initializeApp } from 'firebase-admin/app'
import { type Messaging, getMessaging } from 'firebase-admin/messaging'
import { isFcmTokenDead } from './fcm-token-errors.js'
import type { PushPayload, SendPushResult } from './push-sender.js'

export type SendFcmPush = (deviceToken: string, payload: PushPayload) => Promise<SendPushResult>

export type FcmServiceAccount = {
  projectId: string
  clientEmail: string
  privateKey: string
}

/**
 * Real implementation over `firebase-admin`'s Messaging API — ROADMAP.md
 * 2.9's Android half. Same injectable-function shape (`SendFcmPush`) as
 * push-sender.ts's own `SendPush`, and the same reason: this wrapper is
 * never unit-tested directly (there's no real Firebase project in this
 * environment, and no mobile app yet to receive a push even if there
 * were — the mobile app itself is Phase 4), only wired for real in
 * server.ts. What *is* tested is everything on this file's boundary:
 * fcm-token-errors.ts's own real error-code classification (pinned
 * against the installed SDK's actual source, not just its docs), and
 * notifications.processor.ts's dispatch/cleanup logic via a fake
 * `SendFcmPush`.
 */
export function createFcmPushSender(serviceAccount: FcmServiceAccount): SendFcmPush {
  const app = initializeApp(
    {
      credential: cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey,
      }),
    },
    // Named, not the default app — nothing else in this process calls
    // `initializeApp()`, but a named app can never collide with (or get
    // torn down by) some other future `firebase-admin` usage that does.
    'x-fcm-push-sender',
  )
  const messaging: Messaging = getMessaging(app)

  return async (deviceToken, payload) => {
    try {
      // SPECS.md §14.4 / CODESTYLE.md §10 — "externo 5 s". firebase-admin
      // exposes no send()-level timeout option of its own, hence withTimeout
      // (see its own comment for why a native option is preferred when one
      // exists — Postgres'/Redis' own above — and this is the fallback).
      await withTimeout(
        messaging.send({
          token: deviceToken,
          notification: { title: payload.title, body: payload.body },
          // FCM's `data` payload is string-only — an absent url is encoded
          // as `''` rather than omitted, so the client can always read
          // `data.url` without first checking whether the key exists at all.
          data: { url: payload.url ?? '' },
        }),
        EXTERNAL_CALL_TIMEOUT_MS,
        'fcm',
      )
      return { expired: false }
    } catch (error) {
      if (isFcmTokenDead(error)) return { expired: true }
      // Best-effort, matching push-sender.ts's own web-push catch: one
      // recipient's delivery failure never fails the notification itself.
      console.error('FCM push send failed:', error)
      return { expired: false }
    }
  }
}
