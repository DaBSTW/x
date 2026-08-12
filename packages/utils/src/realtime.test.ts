import { describe, expect, it } from 'vitest'
import {
  conversationChannel,
  postChannel,
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
