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

// FCM (Android)/APNs (iOS) device tokens — ROADMAP.md 2.9's last bullet,
// prepared ahead of the mobile app itself (Phase 4). A registration token
// is a single opaque string handed out by each platform's own push SDK
// (Firebase, or Apple via whatever wraps APNs on-device — Expo's
// `expo-notifications` for the React Native app ROADMAP.md 4 names), so
// unlike Web Push there's no separate keys object to validate.
export const devicePlatformSchema = z.enum(['fcm', 'apns'])
export type DevicePlatform = z.infer<typeof devicePlatformSchema>

export const registerDeviceTokenRequestSchema = z.object({
  platform: devicePlatformSchema,
  token: z.string().min(1),
})
export type RegisterDeviceTokenRequest = z.infer<typeof registerDeviceTokenRequestSchema>

export const unregisterDeviceTokenRequestSchema = z.object({
  token: z.string().min(1),
})
export type UnregisterDeviceTokenRequest = z.infer<typeof unregisterDeviceTokenRequestSchema>
