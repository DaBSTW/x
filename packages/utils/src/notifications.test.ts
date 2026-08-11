import { describe, expect, it } from 'vitest'
import { unreadCountKey } from './notifications.js'

describe('unreadCountKey', () => {
  it('formats a key from a string or bigint id the same way', () => {
    expect(unreadCountKey('123')).toBe('notifications:unread:123')
    expect(unreadCountKey(123n)).toBe('notifications:unread:123')
  })
})
