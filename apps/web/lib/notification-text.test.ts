import type { Notification } from '@x/contracts'
import { describe, expect, it } from 'vitest'
import { notificationHref, notificationText } from './notification-text'

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '1823456789012345678',
    kind: 'like',
    actor: {
      id: '1823456789012345679',
      username: 'ana',
      displayName: 'Ana',
      avatarUrl: null,
      isVerified: false,
    },
    postId: '1823456789012345680',
    groupKey: null,
    isRead: false,
    createdAt: '2026-08-11T12:00:00.000Z',
    ...overrides,
  }
}

describe('notificationText', () => {
  it('renders a like', () => {
    expect(notificationText(makeNotification({ kind: 'like' }))).toBe(
      'Ana le dio me gusta a tu post',
    )
  })

  it('renders a repost', () => {
    expect(notificationText(makeNotification({ kind: 'repost' }))).toBe('Ana reposteó tu post')
  })

  it('renders a reply', () => {
    expect(notificationText(makeNotification({ kind: 'reply' }))).toBe('Ana respondió a tu post')
  })

  it('renders a quote', () => {
    expect(notificationText(makeNotification({ kind: 'quote' }))).toBe('Ana citó tu post')
  })

  it('renders a follow', () => {
    expect(notificationText(makeNotification({ kind: 'follow', postId: null }))).toBe(
      'Ana empezó a seguirte',
    )
  })

  it('renders a mention', () => {
    expect(notificationText(makeNotification({ kind: 'mention' }))).toBe(
      'Ana te mencionó en un post',
    )
  })

  it('renders a follow request', () => {
    expect(notificationText(makeNotification({ kind: 'follow_request', postId: null }))).toBe(
      'Ana quiere seguirte',
    )
  })

  it('renders a system notification with no actor', () => {
    expect(notificationText(makeNotification({ kind: 'system', actor: null, postId: null }))).toBe(
      'Notificación del sistema',
    )
  })

  it('falls back to a generic name when the actor is somehow missing on an actor-carrying kind', () => {
    expect(notificationText(makeNotification({ kind: 'like', actor: null }))).toBe(
      'Alguien le dio me gusta a tu post',
    )
  })
})

describe('notificationHref', () => {
  it('links a post notification to the post page, using the actor as the cosmetic username', () => {
    expect(notificationHref(makeNotification())).toBe('/ana/status/1823456789012345680')
  })

  it('falls back to a placeholder username when a post notification has no actor', () => {
    expect(notificationHref(makeNotification({ actor: null }))).toBe(
      '/x/status/1823456789012345680',
    )
  })

  it('links a follow notification to the actor’s profile', () => {
    expect(notificationHref(makeNotification({ kind: 'follow', postId: null }))).toBe('/ana')
  })

  it('has nowhere to go for a system notification', () => {
    expect(notificationHref(makeNotification({ kind: 'system', actor: null, postId: null }))).toBe(
      null,
    )
  })
})
