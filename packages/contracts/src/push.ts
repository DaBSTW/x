import { z } from 'zod'

// Shape the Push API's PushSubscription.toJSON() produces in the browser —
// ROADMAP.md 2.9 Web Push (VAPID).
export const pushSubscribeRequestSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
})
export type PushSubscribeRequest = z.infer<typeof pushSubscribeRequestSchema>

export const pushUnsubscribeRequestSchema = z.object({
  endpoint: z.string().url(),
})
export type PushUnsubscribeRequest = z.infer<typeof pushUnsubscribeRequestSchema>

export const vapidPublicKeyResponseSchema = z.object({
  // `null` when the server has no VAPID keypair configured — push is
  // disabled rather than a hard failure (graceful degradation, CODESTYLE.md §8.3).
  data: z.object({ publicKey: z.string().nullable() }),
})
