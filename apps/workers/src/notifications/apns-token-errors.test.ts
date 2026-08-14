import { describe, expect, it } from 'vitest'
import { isApnsTokenDead } from './apns-token-errors.js'

describe('isApnsTokenDead', () => {
  it('is true for Unregistered — the device is no longer registered for this topic (HTTP 410)', () => {
    expect(isApnsTokenDead({ response: { reason: 'Unregistered' } })).toBe(true)
  })

  it('is true for BadDeviceToken — malformed, or the wrong app/environment', () => {
    expect(isApnsTokenDead({ response: { reason: 'BadDeviceToken' } })).toBe(true)
  })

  it('is false for a transient reason that could succeed on retry', () => {
    expect(isApnsTokenDead({ response: { reason: 'InternalServerError' } })).toBe(false)
    expect(isApnsTokenDead({ response: { reason: 'TooManyRequests' } })).toBe(false)
  })

  it('is false when there is no response object at all (a transport-level failure, not an APNs rejection)', () => {
    expect(isApnsTokenDead({})).toBe(false)
  })
})
