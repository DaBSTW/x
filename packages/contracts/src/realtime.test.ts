import { describe, expect, it } from 'vitest'
import {
  realtimeChannelSchema,
  realtimeClientMessageSchema,
  realtimeServerMessageSchema,
  realtimeTicketResponseSchema,
} from './realtime.js'

describe('realtimeTicketResponseSchema', () => {
  it('accepts a real ticket response', () => {
    expect(
      realtimeTicketResponseSchema.safeParse({ data: { ticket: 'abc123', expiresIn: 60 } }).success,
    ).toBe(true)
  })

  it('rejects a non-positive expiresIn', () => {
    expect(
      realtimeTicketResponseSchema.safeParse({ data: { ticket: 'abc123', expiresIn: 0 } }).success,
    ).toBe(false)
  })
})

describe('realtimeChannelSchema', () => {
  it.each(['user:123', 'conv:456', 'post:789', 'timeline:123'])('accepts %s', (channel) => {
    expect(realtimeChannelSchema.safeParse(channel).success).toBe(true)
  })

  it.each([
    'user:abc', // not a snowflake id
    'unknown:123', // not one of SPECS.md §8.2's four prefixes
    'user:', // missing id
    'user123', // missing the colon separator entirely
  ])('rejects %s', (channel) => {
    expect(realtimeChannelSchema.safeParse(channel).success).toBe(false)
  })
})

describe('realtimeClientMessageSchema', () => {
  it('accepts a subscribe message', () => {
    const result = realtimeClientMessageSchema.safeParse({
      op: 'subscribe',
      channels: ['user:123'],
    })
    expect(result.success).toBe(true)
  })

  it('accepts an unsubscribe message', () => {
    const result = realtimeClientMessageSchema.safeParse({
      op: 'unsubscribe',
      channels: ['user:123'],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a subscribe message with a since map for lost-event recovery', () => {
    const result = realtimeClientMessageSchema.safeParse({
      op: 'subscribe',
      channels: ['timeline:123'],
      since: { 'timeline:123': '1723-0' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a since map keyed by a malformed channel', () => {
    const result = realtimeClientMessageSchema.safeParse({
      op: 'subscribe',
      channels: ['timeline:123'],
      since: { 'not-a-channel': '1723-0' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty channel list', () => {
    expect(realtimeClientMessageSchema.safeParse({ op: 'subscribe', channels: [] }).success).toBe(
      false,
    )
  })

  it('rejects an unrecognized op', () => {
    expect(
      realtimeClientMessageSchema.safeParse({ op: 'ping', channels: ['user:123'] }).success,
    ).toBe(false)
  })
})

describe('realtimeServerMessageSchema', () => {
  it('accepts a subscribed ack', () => {
    const result = realtimeServerMessageSchema.safeParse({
      op: 'subscribed',
      channels: ['user:123'],
    })
    expect(result.success).toBe(true)
  })

  it('accepts an event envelope with an opaque data payload', () => {
    const result = realtimeServerMessageSchema.safeParse({
      op: 'event',
      channel: 'timeline:123',
      event: 'post.available',
      data: { postId: '456' },
      eventId: '1723-0',
    })
    expect(result.success).toBe(true)
  })

  it('accepts an error message', () => {
    const result = realtimeServerMessageSchema.safeParse({
      op: 'error',
      message: 'unauthorized channel',
    })
    expect(result.success).toBe(true)
  })
})
