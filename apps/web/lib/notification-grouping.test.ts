import type { Notification } from '@x/contracts'
import { describe, expect, it } from 'vitest'
import { groupNotifications } from './notification-grouping'

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

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '1823456789012345678',
    kind: 'like',
    actor: makeActor(),
    postId: '1823456789012345680',
    groupKey: 'like:1823456789012345680',
    isRead: false,
    createdAt: '2026-08-11T12:00:00.000Z',
    ...overrides,
  }
}

describe('groupNotifications', () => {
  it('leaves a single like notification ungrouped', () => {
    const items = groupNotifications([makeNotification()])
    expect(items).toEqual([{ kind: 'single', notification: expect.any(Object) }])
  })

  it('leaves notifications with a null groupKey (reply/quote/mention) always ungrouped, even back to back', () => {
    const items = groupNotifications([
      makeNotification({ id: '2', kind: 'reply', groupKey: null }),
      makeNotification({ id: '1', kind: 'reply', groupKey: null }),
    ])
    expect(items).toEqual([
      { kind: 'single', notification: expect.objectContaining({ id: '2' }) },
      { kind: 'single', notification: expect.objectContaining({ id: '1' }) },
    ])
  })

  it('collapses consecutive likes on the same post into one group, newest first preserved inside it', () => {
    const items = groupNotifications([
      makeNotification({ id: '3', actor: makeActor({ id: 'c', displayName: 'Carla' }) }),
      makeNotification({ id: '2', actor: makeActor({ id: 'b', displayName: 'Bea' }) }),
      makeNotification({ id: '1', actor: makeActor({ id: 'a', displayName: 'Ana' }) }),
    ])
    expect(items).toHaveLength(1)
    const item = items[0]
    if (item?.kind !== 'group') throw new Error('expected a group')
    expect(item.group.notifications.map((n) => n.id)).toEqual(['3', '2', '1'])
    expect(item.group.actors.map((a) => a.displayName)).toEqual(['Carla', 'Bea', 'Ana'])
    expect(item.group.kind).toBe('like')
    expect(item.group.postId).toBe('1823456789012345680')
  })

  it('does not merge a like and a repost on the same post — different groupKey strings', () => {
    const items = groupNotifications([
      makeNotification({ id: '2', kind: 'repost', groupKey: 'repost:1823456789012345680' }),
      makeNotification({ id: '1', kind: 'like', groupKey: 'like:1823456789012345680' }),
    ])
    expect(items).toEqual([
      { kind: 'single', notification: expect.objectContaining({ id: '2' }) },
      { kind: 'single', notification: expect.objectContaining({ id: '1' }) },
    ])
  })

  it('does not merge likes on two different posts', () => {
    const items = groupNotifications([
      makeNotification({ id: '2', postId: '999', groupKey: 'like:999' }),
      makeNotification({ id: '1', postId: '888', groupKey: 'like:888' }),
    ])
    expect(items).toHaveLength(2)
  })

  it('breaks a run when an unrelated notification sits between two same-groupKey ones', () => {
    const items = groupNotifications([
      makeNotification({ id: '3' }),
      makeNotification({ id: '2', kind: 'reply', groupKey: null }),
      makeNotification({ id: '1' }),
    ])
    expect(items).toHaveLength(3)
    expect(items.every((item) => item.kind === 'single')).toBe(true)
  })

  it('does not merge the same groupKey across more than the 1h window (ROADMAP.md 1.7)', () => {
    const items = groupNotifications([
      makeNotification({ id: '2', createdAt: '2026-08-11T12:00:00.000Z' }),
      makeNotification({ id: '1', createdAt: '2026-08-11T10:59:00.000Z' }), // 61 min earlier
    ])
    expect(items).toEqual([
      { kind: 'single', notification: expect.objectContaining({ id: '2' }) },
      { kind: 'single', notification: expect.objectContaining({ id: '1' }) },
    ])
  })

  it('merges the same groupKey right at the edge of the 1h window', () => {
    const items = groupNotifications([
      makeNotification({ id: '2', createdAt: '2026-08-11T12:00:00.000Z' }),
      makeNotification({ id: '1', createdAt: '2026-08-11T11:00:00.000Z' }), // exactly 60 min earlier
    ])
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('group')
  })

  it('measures the window from the run’s newest member, not a sliding one from the last-added member', () => {
    // Three likes 40 min apart each: #3→#2 is 40min (within), #2→#1 is another
    // 40min (80min from #3). Anchored to #3 (the run's first/newest member),
    // #1 is 80min away — outside the window — so it must start its own run,
    // even though it's within 40min of #2.
    const items = groupNotifications([
      makeNotification({ id: '3', createdAt: '2026-08-11T14:00:00.000Z' }),
      makeNotification({ id: '2', createdAt: '2026-08-11T13:20:00.000Z' }),
      makeNotification({ id: '1', createdAt: '2026-08-11T12:40:00.000Z' }),
    ])
    expect(items).toHaveLength(2)
    const [first, second] = items
    if (first?.kind !== 'group') throw new Error('expected a group first')
    expect(first.group.notifications.map((n) => n.id)).toEqual(['3', '2'])
    expect(second).toEqual({ kind: 'single', notification: expect.objectContaining({ id: '1' }) })
  })

  it('de-dupes an actor who appears more than once in the same run', () => {
    const items = groupNotifications([
      makeNotification({ id: '2', actor: makeActor({ id: 'a', displayName: 'Ana' }) }),
      makeNotification({ id: '1', actor: makeActor({ id: 'a', displayName: 'Ana' }) }),
    ])
    const item = items[0]
    if (item?.kind !== 'group') throw new Error('expected a group')
    expect(item.group.actors).toHaveLength(1)
  })

  it('a group is read only when every one of its members is', () => {
    const items = groupNotifications([
      makeNotification({ id: '2', isRead: true }),
      makeNotification({ id: '1', isRead: false }),
    ])
    const item = items[0]
    if (item?.kind !== 'group') throw new Error('expected a group')
    expect(item.group.isRead).toBe(false)
  })

  it('returns an empty list for an empty input', () => {
    expect(groupNotifications([])).toEqual([])
  })
})
