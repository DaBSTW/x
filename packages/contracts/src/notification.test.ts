import { describe, expect, it } from 'vitest'
import { markNotificationsReadSchema, notificationSchema } from './notification.js'

const actor = {
  id: '1823456789012345678',
  username: 'ana',
  displayName: 'Ana',
  avatarUrl: null,
  isVerified: false,
}

describe('notificationSchema', () => {
  it('accepts a notification with an actor', () => {
    const result = notificationSchema.safeParse({
      id: '1823456789012345679',
      kind: 'like',
      actor,
      postId: '1823456789012345000',
      groupKey: 'like:1823456789012345000',
      isRead: false,
      createdAt: '2026-08-11T14:32:00Z',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a system notification with a null actor and postId', () => {
    const result = notificationSchema.safeParse({
      id: '1823456789012345679',
      kind: 'system',
      actor: null,
      postId: null,
      groupKey: null,
      isRead: false,
      createdAt: '2026-08-11T14:32:00Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown kind', () => {
    const result = notificationSchema.safeParse({
      id: '1823456789012345679',
      kind: 'bogus',
      actor: null,
      postId: null,
      groupKey: null,
      isRead: false,
      createdAt: '2026-08-11T14:32:00Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('markNotificationsReadSchema', () => {
  it('requires a numeric cursor', () => {
    expect(markNotificationsReadSchema.safeParse({ cursor: '123' }).success).toBe(true)
    expect(markNotificationsReadSchema.safeParse({ cursor: 'not-a-number' }).success).toBe(false)
  })
})
