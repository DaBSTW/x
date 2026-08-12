import type { NotificationPreference } from '@x/contracts'
import type { NotificationPreference as NotificationPreferenceRow } from '@x/db'
import { generateId } from '@x/utils'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it } from 'vitest'
import type { NotificationRow, NotificationsRepository } from './notifications.repository.js'
import { createNotificationsService } from './notifications.service.js'

function makeRow(
  overrides: Partial<NotificationRow> & Pick<NotificationRow, 'id'>,
): NotificationRow {
  return {
    kind: 'like',
    postId: null,
    groupKey: null,
    readAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    actorId: null,
    actorUsername: null,
    actorDisplayName: null,
    actorAvatarUrl: null,
    actorIsVerified: null,
    ...overrides,
  }
}

// Hand-rolled — models only GET/SET/EXISTS/DECRBY, the commands
// notifications.service.ts actually issues.
function createFakeRedis(): Redis {
  const store = new Map<string, number>()
  return {
    async get(key: string) {
      const value = store.get(key)
      return value === undefined ? null : String(value)
    },
    async set(key: string, value: number) {
      store.set(key, Number(value))
      return 'OK'
    },
    async exists(key: string) {
      return store.has(key) ? 1 : 0
    },
    async decrby(key: string, amount: number) {
      const next = (store.get(key) ?? 0) - amount
      store.set(key, next)
      return next
    },
  } as unknown as Redis
}

describe('createNotificationsService', () => {
  let redis: Redis
  let rows: NotificationRow[]
  let repository: NotificationsRepository
  let markReadUpToCalls: Array<{ userId: bigint; cursor: bigint }>
  let preferenceOverrides: NotificationPreferenceRow[]

  beforeEach(() => {
    redis = createFakeRedis()
    rows = []
    markReadUpToCalls = []
    preferenceOverrides = []
    repository = {
      async listForUser(_userId, limit) {
        return rows.slice(0, limit)
      },
      async markReadUpTo(userId, cursor) {
        markReadUpToCalls.push({ userId, cursor })
        const unread = rows.filter((row) => row.id <= cursor && row.readAt === null)
        for (const row of unread) row.readAt = new Date()
        return unread.length
      },
      async countUnread(_userId) {
        return rows.filter((row) => row.readAt === null).length
      },
      async listPreferenceOverrides(userId) {
        return preferenceOverrides.filter((row) => row.userId === userId)
      },
      async setPreference(userId, kind, channel, enabled) {
        const existing = preferenceOverrides.find(
          (row) => row.userId === userId && row.kind === kind && row.channel === channel,
        )
        if (existing) {
          existing.enabled = enabled
        } else {
          preferenceOverrides.push({ userId, kind, channel, enabled })
        }
      },
    }
  })

  describe('list', () => {
    it('maps rows to the contract shape and paginates with hasMore', async () => {
      const userId = generateId()
      rows = [makeRow({ id: 3n }), makeRow({ id: 2n }), makeRow({ id: 1n })]
      const service = createNotificationsService(repository, redis)

      const page = await service.list(userId, 2, null)

      expect(page.items.map((item) => item.id)).toEqual(['3', '2'])
      expect(page.hasMore).toBe(true)
    })

    it('includes actor info when present, null when absent (system notifications)', async () => {
      const userId = generateId()
      const actorId = generateId()
      rows = [
        makeRow({
          id: 1n,
          actorId,
          actorUsername: 'ana',
          actorDisplayName: 'Ana',
          actorAvatarUrl: null,
          actorIsVerified: true,
        }),
        makeRow({ id: 2n, kind: 'system' }),
      ]
      const service = createNotificationsService(repository, redis)

      const page = await service.list(userId, 20, null)

      expect(page.items[0]?.actor).toEqual({
        id: actorId.toString(),
        username: 'ana',
        displayName: 'Ana',
        avatarUrl: null,
        isVerified: true,
      })
      expect(page.items[1]?.actor).toBeNull()
    })
  })

  describe('markRead', () => {
    it('decrements a warm counter by exactly what changed', async () => {
      const userId = generateId()
      rows = [makeRow({ id: 1n }), makeRow({ id: 2n }), makeRow({ id: 3n })]
      await redis.set(`notifications:unread:${userId}`, 3)
      const service = createNotificationsService(repository, redis)

      await service.markRead(userId, 2n)

      expect(await service.getUnreadCount(userId)).toBe(1)
    })

    it('seeds a cold counter with the post-update true count instead of guessing', async () => {
      const userId = generateId()
      rows = [makeRow({ id: 1n }), makeRow({ id: 2n })]
      const service = createNotificationsService(repository, redis)

      await service.markRead(userId, 1n)

      expect(await service.getUnreadCount(userId)).toBe(1)
    })

    it('does nothing when nothing changed', async () => {
      const userId = generateId()
      rows = [makeRow({ id: 1n, readAt: new Date() })]
      const service = createNotificationsService(repository, redis)

      await service.markRead(userId, 1n)

      expect(markReadUpToCalls).toHaveLength(1)
      expect(await redis.exists(`notifications:unread:${userId}`)).toBe(0)
    })
  })

  describe('getUnreadCount', () => {
    it('seeds from Postgres on a cold miss', async () => {
      const userId = generateId()
      rows = [makeRow({ id: 1n }), makeRow({ id: 2n, readAt: new Date() })]
      const service = createNotificationsService(repository, redis)

      expect(await service.getUnreadCount(userId)).toBe(1)
      expect(await redis.get(`notifications:unread:${userId}`)).toBe('1')
    })

    it('never returns a negative count', async () => {
      const userId = generateId()
      await redis.set(`notifications:unread:${userId}`, -3)
      const service = createNotificationsService(repository, redis)

      expect(await service.getUnreadCount(userId)).toBe(0)
    })
  })

  describe('getPreferences', () => {
    function find(
      preferences: NotificationPreference[],
      kind: NotificationPreference['kind'],
      channel: NotificationPreference['channel'],
    ) {
      return preferences.find((p) => p.kind === kind && p.channel === channel)
    }

    it('defaults in_app to enabled and push to the SPECS.md §13.2 set, with no overrides stored', async () => {
      const userId = generateId()
      const service = createNotificationsService(repository, redis)

      const preferences = await service.getPreferences(userId)

      expect(preferences).toHaveLength(14) // 7 configurable kinds × 2 channels
      expect(find(preferences, 'like', 'in_app')?.enabled).toBe(true)
      expect(find(preferences, 'like', 'push')?.enabled).toBe(false)
      expect(find(preferences, 'mention', 'push')?.enabled).toBe(true)
      expect(find(preferences, 'follow', 'push')?.enabled).toBe(true)
    })

    it('layers a stored override on top of the default', async () => {
      const userId = generateId()
      preferenceOverrides = [{ userId, kind: 'like', channel: 'push', enabled: true }]
      const service = createNotificationsService(repository, redis)

      const preferences = await service.getPreferences(userId)

      expect(find(preferences, 'like', 'push')?.enabled).toBe(true)
      // Unrelated defaults are untouched by the override.
      expect(find(preferences, 'repost', 'push')?.enabled).toBe(false)
    })

    it("never mixes another user's overrides in", async () => {
      const userId = generateId()
      const otherUserId = generateId()
      preferenceOverrides = [
        { userId: otherUserId, kind: 'mention', channel: 'push', enabled: false },
      ]
      const service = createNotificationsService(repository, redis)

      const preferences = await service.getPreferences(userId)

      expect(find(preferences, 'mention', 'push')?.enabled).toBe(true)
    })
  })

  describe('updatePreference', () => {
    it('persists an override that getPreferences then reflects', async () => {
      const userId = generateId()
      const service = createNotificationsService(repository, redis)

      await service.updatePreference(userId, { kind: 'reply', channel: 'push', enabled: true })
      const preferences = await service.getPreferences(userId)

      expect(preferences.find((p) => p.kind === 'reply' && p.channel === 'push')?.enabled).toBe(
        true,
      )
    })
  })
})
