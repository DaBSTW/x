import { describe, expect, it } from 'vitest'
import {
  pushSubscribeRequestSchema,
  pushUnsubscribeRequestSchema,
  vapidPublicKeyResponseSchema,
} from './push.js'

describe('pushSubscribeRequestSchema', () => {
  it('accepts a real PushSubscription.toJSON() shape', () => {
    const result = pushSubscribeRequestSchema.safeParse({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-URL endpoint', () => {
    expect(
      pushSubscribeRequestSchema.safeParse({
        endpoint: 'not-a-url',
        keys: { p256dh: 'k', auth: 'k' },
      }).success,
    ).toBe(false)
  })

  it('rejects missing keys', () => {
    expect(
      pushSubscribeRequestSchema.safeParse({ endpoint: 'https://example.com/push' }).success,
    ).toBe(false)
  })
})

describe('pushUnsubscribeRequestSchema', () => {
  it('requires just the endpoint', () => {
    expect(
      pushUnsubscribeRequestSchema.safeParse({ endpoint: 'https://example.com/push' }).success,
    ).toBe(true)
  })
})

describe('vapidPublicKeyResponseSchema', () => {
  it('accepts a configured key', () => {
    expect(
      vapidPublicKeyResponseSchema.safeParse({ data: { publicKey: 'base64url-key' } }).success,
    ).toBe(true)
  })

  it('accepts null when push is not configured', () => {
    expect(vapidPublicKeyResponseSchema.safeParse({ data: { publicKey: null } }).success).toBe(true)
  })
})
