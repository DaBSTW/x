import { describe, expect, it } from 'vitest'
import { defaultChannelEnabled, unreadCountKey } from './notifications.js'

describe('unreadCountKey', () => {
  it('formats a key from a string or bigint id the same way', () => {
    expect(unreadCountKey('123')).toBe('notifications:unread:123')
    expect(unreadCountKey(123n)).toBe('notifications:unread:123')
  })
})

describe('defaultChannelEnabled', () => {
  it('defaults in_app to enabled for every configurable kind', () => {
    expect(defaultChannelEnabled('like', 'in_app')).toBe(true)
    expect(defaultChannelEnabled('follow', 'in_app')).toBe(true)
  })

  it('defaults push to SPECS.md §13.2’s set: follow, mention, follow_request', () => {
    expect(defaultChannelEnabled('follow', 'push')).toBe(true)
    expect(defaultChannelEnabled('mention', 'push')).toBe(true)
    expect(defaultChannelEnabled('follow_request', 'push')).toBe(true)
  })

  it('defaults push to disabled for the higher-volume kinds', () => {
    expect(defaultChannelEnabled('like', 'push')).toBe(false)
    expect(defaultChannelEnabled('repost', 'push')).toBe(false)
    expect(defaultChannelEnabled('reply', 'push')).toBe(false)
    expect(defaultChannelEnabled('quote', 'push')).toBe(false)
  })
})
