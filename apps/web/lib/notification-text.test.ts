import type { Notification } from '@x/contracts'
import { describe, expect, it } from 'vitest'
import type { NotificationGroup } from './notification-grouping'
import {
  groupedNotificationHref,
  groupedNotificationText,
  notificationHref,
  notificationText,
} from './notification-text'

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

function makeActor(overrides: Partial<NonNullable<Notification['actor']>> = {}) {
  return {
    id: '1823456789012345679',
    username: 'ana',
    displayName: 'Ana',
    avatarUrl: null,
    isVerified: false,
    ...overrides,
  }
}

function makeGroup(overrides: Partial<NotificationGroup> = {}): NotificationGroup {
  return {
    groupKey: 'like:1823456789012345680',
    kind: 'like',
    notifications: [makeNotification()],
    actors: [makeActor()],
    postId: '1823456789012345680',
    isRead: false,
    createdAt: '2026-08-11T12:00:00.000Z',
    ...overrides,
  }
}

describe('groupedNotificationText', () => {
  it('names both actors in full for a group of exactly two', () => {
    const group = makeGroup({
      actors: [makeActor({ displayName: 'Ana' }), makeActor({ id: 'b', displayName: 'Bea' })],
    })
    expect(groupedNotificationText(group)).toBe('Ana y Bea le dieron me gusta a tu post')
  })

  it('collapses to "and N more" for a group of three or more', () => {
    const group = makeGroup({
      actors: [
        makeActor({ displayName: 'Ana' }),
        makeActor({ id: 'b', displayName: 'Bea' }),
        makeActor({ id: 'c', displayName: 'Carla' }),
      ],
    })
    expect(groupedNotificationText(group)).toBe('Ana y 2 más le dieron me gusta a tu post')
  })

  it('renders a repost group', () => {
    const group = makeGroup({
      kind: 'repost',
      actors: [makeActor({ displayName: 'Ana' }), makeActor({ id: 'b', displayName: 'Bea' })],
    })
    expect(groupedNotificationText(group)).toBe('Ana y Bea repostearon tu post')
  })

  it('renders a follow group', () => {
    const group = makeGroup({
      kind: 'follow',
      postId: null,
      actors: [makeActor({ displayName: 'Ana' }), makeActor({ id: 'b', displayName: 'Bea' })],
    })
    expect(groupedNotificationText(group)).toBe('Ana y Bea empezaron a seguirte')
  })

  // The backend never actually groups these four (ROADMAP.md 1.7: reply/
  // quote/mention keep a null groupKey on purpose, and 'system' has no
  // actor at all) — covered anyway since the switch is exhaustive by type,
  // not by what group_key.ts happens to produce today.
  it('renders a reply group', () => {
    const group = makeGroup({
      kind: 'reply',
      actors: [makeActor({ displayName: 'Ana' }), makeActor({ id: 'b', displayName: 'Bea' })],
    })
    expect(groupedNotificationText(group)).toBe('Ana y Bea respondieron a tu post')
  })

  it('renders a quote group', () => {
    const group = makeGroup({
      kind: 'quote',
      actors: [makeActor({ displayName: 'Ana' }), makeActor({ id: 'b', displayName: 'Bea' })],
    })
    expect(groupedNotificationText(group)).toBe('Ana y Bea citaron tu post')
  })

  it('renders a mention group', () => {
    const group = makeGroup({
      kind: 'mention',
      actors: [makeActor({ displayName: 'Ana' }), makeActor({ id: 'b', displayName: 'Bea' })],
    })
    expect(groupedNotificationText(group)).toBe('Ana y Bea te mencionaron en un post')
  })

  it('renders a follow_request group', () => {
    const group = makeGroup({
      kind: 'follow_request',
      postId: null,
      actors: [makeActor({ displayName: 'Ana' }), makeActor({ id: 'b', displayName: 'Bea' })],
    })
    expect(groupedNotificationText(group)).toBe('Ana y Bea quieren seguirte')
  })

  it('renders a system group the same as a single system notification', () => {
    const group = makeGroup({ kind: 'system', postId: null, actors: [] })
    expect(groupedNotificationText(group)).toBe('Notificación del sistema')
  })

  it('names the one actor plainly when de-duping left only one behind a multi-notification group', () => {
    const group = makeGroup({ actors: [makeActor({ displayName: 'Ana' })] })
    expect(groupedNotificationText(group)).toBe('Ana le dio me gusta a tu post')
  })

  it('falls back to a generic singular name when a group somehow has no actors', () => {
    expect(groupedNotificationText(makeGroup({ actors: [] }))).toBe(
      'Alguien le dio me gusta a tu post',
    )
  })
})

describe('groupedNotificationHref', () => {
  it('links a post group to the post, using the newest actor as the cosmetic username', () => {
    const group = makeGroup({
      actors: [makeActor({ username: 'carla' }), makeActor({ id: 'b', username: 'bea' })],
    })
    expect(groupedNotificationHref(group)).toBe('/carla/status/1823456789012345680')
  })

  it('links a follow group to the newest actor’s profile', () => {
    const group = makeGroup({
      kind: 'follow',
      postId: null,
      actors: [makeActor({ username: 'carla' })],
    })
    expect(groupedNotificationHref(group)).toBe('/carla')
  })

  it('has nowhere to go for a group with neither a post nor any actor', () => {
    expect(groupedNotificationHref(makeGroup({ postId: null, actors: [] }))).toBe(null)
  })
})
