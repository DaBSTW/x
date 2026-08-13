import { describe, expect, it } from 'vitest'
import {
  MESSAGE_CREATED_EVENT,
  POST_AVAILABLE_EVENT,
  REALTIME_STREAM_FIELD_DATA,
  REALTIME_STREAM_FIELD_EVENT,
  conversationChannel,
  postChannel,
  realtimeStreamKey,
  realtimeTicketKey,
  timelineChannel,
  userChannel,
} from './realtime.js'

describe('realtimeTicketKey', () => {
  it('namespaces a ticket hash under realtime:ticket:', () => {
    expect(realtimeTicketKey('abc123')).toBe('realtime:ticket:abc123')
  })
})

describe('channel builders', () => {
  it('accepts both string and bigint ids, matching SPECS.md §8.2 formats', () => {
    expect(userChannel(123n)).toBe('user:123')
    expect(userChannel('123')).toBe('user:123')
    expect(conversationChannel(456n)).toBe('conv:456')
    expect(postChannel(789n)).toBe('post:789')
    expect(timelineChannel(123n)).toBe('timeline:123')
  })
})

describe('realtimeStreamKey', () => {
  it('namespaces a channel under realtime:stream:, distinct from the pub/sub channel name itself', () => {
    expect(realtimeStreamKey('timeline:123')).toBe('realtime:stream:timeline:123')
  })
})

describe('stream field names and event kinds', () => {
  it('are distinct, stable strings — the only contract between the XADD writer and the XRANGE reader', () => {
    expect(REALTIME_STREAM_FIELD_EVENT).toBe('event')
    expect(REALTIME_STREAM_FIELD_DATA).toBe('data')
    expect(REALTIME_STREAM_FIELD_EVENT).not.toBe(REALTIME_STREAM_FIELD_DATA)
    expect(POST_AVAILABLE_EVENT).toBe('post.available')
    expect(MESSAGE_CREATED_EVENT).toBe('message.created')
    expect(POST_AVAILABLE_EVENT).not.toBe(MESSAGE_CREATED_EVENT)
  })
})
