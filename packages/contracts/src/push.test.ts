import { describe, expect, it } from 'vitest'
import {
  pushSubscribeRequestSchema,
  pushUnsubscribeRequestSchema,
  registerDeviceTokenRequestSchema,
  unregisterDeviceTokenRequestSchema,
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

describe('registerDeviceTokenRequestSchema', () => {
  it.each(['fcm', 'apns'])('accepts platform %s with a token', (platform) => {
    const result = registerDeviceTokenRequestSchema.safeParse({ platform, token: 'a-real-token' })
    expect(result.success).toBe(true)
  })

  it('rejects an unrecognized platform', () => {
    expect(
      registerDeviceTokenRequestSchema.safeParse({ platform: 'windows-phone', token: 't' }).success,
    ).toBe(false)
  })

  it('rejects an empty token', () => {
    expect(registerDeviceTokenRequestSchema.safeParse({ platform: 'fcm', token: '' }).success).toBe(
      false,
    )
  })
})

describe('unregisterDeviceTokenRequestSchema', () => {
  it('requires just the token', () => {
    expect(unregisterDeviceTokenRequestSchema.safeParse({ token: 'abc' }).success).toBe(true)
  })

  it('rejects an empty token', () => {
    expect(unregisterDeviceTokenRequestSchema.safeParse({ token: '' }).success).toBe(false)
  })
})
