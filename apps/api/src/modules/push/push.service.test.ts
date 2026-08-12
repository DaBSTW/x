import { generateId } from '@x/utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PushRepository } from './push.repository.js'
import { createPushService } from './push.service.js'

type StoredSubscription = {
  userId: bigint
  endpoint: string
  p256dh: string
  authKey: string
  userAgent: string | null
}

describe('createPushService', () => {
  let subscriptions: StoredSubscription[]
  let repository: PushRepository

  beforeEach(() => {
    subscriptions = []
    repository = {
      async upsertSubscription(input) {
        const existing = subscriptions.find((row) => row.endpoint === input.endpoint)
        if (existing) {
          Object.assign(existing, input)
        } else {
          subscriptions.push(input)
        }
      },
      async deleteSubscription(userId, endpoint) {
        subscriptions = subscriptions.filter(
          (row) => !(row.userId === userId && row.endpoint === endpoint),
        )
      },
    }
  })

  describe('getVapidPublicKey', () => {
    it('returns whatever the server was configured with', () => {
      expect(createPushService({ repository, vapidPublicKey: 'abc' }).getVapidPublicKey()).toBe(
        'abc',
      )
      expect(createPushService({ repository, vapidPublicKey: null }).getVapidPublicKey()).toBeNull()
    })
  })

  describe('subscribe', () => {
    it('stores a new subscription', async () => {
      const userId = generateId()
      const service = createPushService({ repository, vapidPublicKey: 'abc' })

      await service.subscribe(userId, {
        endpoint: 'https://push.example.com/abc',
        p256dh: 'p256dh',
        authKey: 'auth',
        userAgent: 'test-agent',
      })

      expect(subscriptions).toHaveLength(1)
      expect(subscriptions[0]?.userId).toBe(userId)
    })

    it('re-subscribing the same endpoint updates it in place rather than duplicating', async () => {
      const userId = generateId()
      const otherUserId = generateId()
      const service = createPushService({ repository, vapidPublicKey: 'abc' })
      const endpoint = 'https://push.example.com/abc'

      await service.subscribe(userId, { endpoint, p256dh: 'old', authKey: 'old', userAgent: null })
      await service.subscribe(otherUserId, {
        endpoint,
        p256dh: 'new',
        authKey: 'new',
        userAgent: null,
      })

      expect(subscriptions).toHaveLength(1)
      expect(subscriptions[0]?.userId).toBe(otherUserId)
      expect(subscriptions[0]?.p256dh).toBe('new')
    })
  })

  describe('unsubscribe', () => {
    it('removes the subscription for that user and endpoint', async () => {
      const userId = generateId()
      const service = createPushService({ repository, vapidPublicKey: 'abc' })
      const endpoint = 'https://push.example.com/abc'
      await service.subscribe(userId, { endpoint, p256dh: 'p', authKey: 'a', userAgent: null })

      await service.unsubscribe(userId, endpoint)

      expect(subscriptions).toHaveLength(0)
    })

    it("does not remove another user's subscription at the same endpoint", async () => {
      const userId = generateId()
      const otherUserId = generateId()
      const service = createPushService({ repository, vapidPublicKey: 'abc' })
      const endpoint = 'https://push.example.com/abc'
      await service.subscribe(userId, { endpoint, p256dh: 'p', authKey: 'a', userAgent: null })

      await service.unsubscribe(otherUserId, endpoint)

      expect(subscriptions).toHaveLength(1)
    })
  })
})
