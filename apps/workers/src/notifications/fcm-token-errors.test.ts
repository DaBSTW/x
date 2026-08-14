import { describe, expect, it } from 'vitest'
import { isFcmTokenDead } from './fcm-token-errors.js'

describe('isFcmTokenDead', () => {
  it('is true for a not-registered token — the app was uninstalled or the token revoked', () => {
    expect(isFcmTokenDead({ code: 'messaging/registration-token-not-registered' })).toBe(true)
  })

  it('is true for a malformed/wrong-project token', () => {
    expect(isFcmTokenDead({ code: 'messaging/invalid-registration-token' })).toBe(true)
  })

  it('is false for a transient error that could succeed on retry', () => {
    expect(isFcmTokenDead({ code: 'messaging/internal-error' })).toBe(false)
    expect(isFcmTokenDead({ code: 'messaging/server-unavailable' })).toBe(false)
  })

  it('is false for a non-FirebaseMessagingError value', () => {
    expect(isFcmTokenDead(new Error('network down'))).toBe(false)
    expect(isFcmTokenDead('a plain string')).toBe(false)
    expect(isFcmTokenDead(null)).toBe(false)
    expect(isFcmTokenDead(undefined)).toBe(false)
  })
})
