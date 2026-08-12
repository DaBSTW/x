import { generateId } from '@x/utils'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it } from 'vitest'
import { createNotificationsProcessor } from './notifications.processor.js'
import type { NotificationsRepository, PushSubscriptionRow } from './notifications.repository.js'
import type { PushPayload, PushSubscriptionTarget, SendPushResult } from './push-sender.js'

function createFakeRedis() {
  const store = new Map<string, number>()
  const redis = {
    async exists(key: string) {
      return store.has(key) ? 1 : 0
    },
    async incr(key: string) {
      const next = (store.get(key) ?? 0) + 1
      store.set(key, next)
      return next
    },
  } as unknown as Redis
  return { redis, store }
}

function createFakeRepository(
  overrides: Partial<NotificationsRepository> = {},
): NotificationsRepository {
  return {
    insertFromJob: async () => generateId(),
    isPushEnabled: async () => false,
    findPushSubscriptions: async () => [],
    deleteSubscriptionByEndpoint: async () => {},
    findUsername: async () => null,
    ...overrides,
  }
}

describe('createNotificationsProcessor', () => {
  let redis: ReturnType<typeof createFakeRedis>

  beforeEach(() => {
    redis = createFakeRedis()
  })

  it('bumps an already-warm counter after a successful insert', async () => {
    const userId = generateId()
    await redis.redis.incr(`notifications:unread:${userId}`) // pre-warm to 1
    const process = createNotificationsProcessor({
      repository: createFakeRepository(),
      redis: redis.redis,
    })

    await process({
      userId: userId.toString(),
      kind: 'follow',
      actorId: '1',
      postId: null,
      groupKey: null,
    })

    expect(redis.store.get(`notifications:unread:${userId}`)).toBe(2)
  })

  it('does nothing when the insert was suppressed', async () => {
    const userId = generateId()
    let sendPushCalled = false
    const process = createNotificationsProcessor({
      repository: createFakeRepository({ insertFromJob: async () => null }),
      redis: redis.redis,
      sendPush: async () => {
        sendPushCalled = true
        return { expired: false }
      },
    })

    await process({
      userId: userId.toString(),
      kind: 'like',
      actorId: '1',
      postId: '1',
      groupKey: null,
    })

    expect(sendPushCalled).toBe(false)
  })

  it('never attempts a push when sendPush is not configured (no VAPID keys)', async () => {
    const userId = generateId()
    const process = createNotificationsProcessor({
      repository: createFakeRepository({
        isPushEnabled: async () => true,
        findPushSubscriptions: async () => [{ endpoint: 'e', p256dh: 'p', authKey: 'a' }],
      }),
      redis: redis.redis,
      // sendPush omitted entirely
    })

    // Would throw if the processor tried to call an undefined sendPush.
    await expect(
      process({
        userId: userId.toString(),
        kind: 'follow',
        actorId: '1',
        postId: null,
        groupKey: null,
      }),
    ).resolves.toBeUndefined()
  })

  it('skips push when the recipient disabled it for this kind', async () => {
    const userId = generateId()
    let sendPushCalled = false
    const process = createNotificationsProcessor({
      repository: createFakeRepository({
        isPushEnabled: async () => false,
        findPushSubscriptions: async () => [{ endpoint: 'e', p256dh: 'p', authKey: 'a' }],
      }),
      redis: redis.redis,
      sendPush: async () => {
        sendPushCalled = true
        return { expired: false }
      },
    })

    await process({
      userId: userId.toString(),
      kind: 'follow',
      actorId: '1',
      postId: null,
      groupKey: null,
    })

    expect(sendPushCalled).toBe(false)
  })

  it('skips push when there are no subscriptions', async () => {
    const userId = generateId()
    let sendPushCalled = false
    const process = createNotificationsProcessor({
      repository: createFakeRepository({
        isPushEnabled: async () => true,
        findPushSubscriptions: async () => [],
      }),
      redis: redis.redis,
      sendPush: async () => {
        sendPushCalled = true
        return { expired: false }
      },
    })

    await process({
      userId: userId.toString(),
      kind: 'mention',
      actorId: '1',
      postId: '1',
      groupKey: null,
    })

    expect(sendPushCalled).toBe(false)
  })

  it('sends to every subscription with the actor username and a post link', async () => {
    const userId = generateId()
    const actorId = generateId()
    const subscriptions: PushSubscriptionRow[] = [
      { endpoint: 'e1', p256dh: 'p1', authKey: 'a1' },
      { endpoint: 'e2', p256dh: 'p2', authKey: 'a2' },
    ]
    const sent: Array<{ subscription: PushSubscriptionTarget; payload: PushPayload }> = []
    const process = createNotificationsProcessor({
      repository: createFakeRepository({
        isPushEnabled: async () => true,
        findPushSubscriptions: async () => subscriptions,
        findUsername: async () => 'ana',
      }),
      redis: redis.redis,
      sendPush: async (subscription, payload) => {
        sent.push({ subscription, payload })
        return { expired: false }
      },
    })

    await process({
      userId: userId.toString(),
      kind: 'mention',
      actorId: actorId.toString(),
      postId: '42',
      groupKey: null,
    })

    expect(sent).toHaveLength(2)
    expect(sent.map((s) => s.subscription.endpoint).sort()).toEqual(['e1', 'e2'])
    expect(sent[0]?.payload).toEqual({
      title: 'X',
      body: '@ana te mencionó en un post',
      url: '/ana/status/42',
    })
  })

  it('deletes a subscription the push service reports as expired', async () => {
    const userId = generateId()
    const deleted: string[] = []
    const process = createNotificationsProcessor({
      repository: createFakeRepository({
        isPushEnabled: async () => true,
        findPushSubscriptions: async () => [
          { endpoint: 'stale-endpoint', p256dh: 'p', authKey: 'a' },
          { endpoint: 'fresh-endpoint', p256dh: 'p', authKey: 'a' },
        ],
        deleteSubscriptionByEndpoint: async (endpoint) => {
          deleted.push(endpoint)
        },
      }),
      redis: redis.redis,
      sendPush: async (subscription): Promise<SendPushResult> => ({
        expired: subscription.endpoint === 'stale-endpoint',
      }),
    })

    await process({
      userId: userId.toString(),
      kind: 'follow',
      actorId: '1',
      postId: null,
      groupKey: null,
    })

    expect(deleted).toEqual(['stale-endpoint'])
  })

  it('skips the username lookup entirely when the job has no actor', async () => {
    const userId = generateId()
    let findUsernameCalled = false
    const sent: PushPayload[] = []
    const process = createNotificationsProcessor({
      repository: createFakeRepository({
        isPushEnabled: async () => true,
        findPushSubscriptions: async () => [{ endpoint: 'e', p256dh: 'p', authKey: 'a' }],
        findUsername: async () => {
          findUsernameCalled = true
          return 'unused'
        },
      }),
      redis: redis.redis,
      sendPush: async (_subscription, payload) => {
        sent.push(payload)
        return { expired: false }
      },
    })

    // Not a realistic combination in production (isPushEnabled is false for
    // 'system', the only kind with a null actorId) but exercises the guard
    // directly rather than relying on that invariant holding elsewhere.
    await process({
      userId: userId.toString(),
      kind: 'follow',
      actorId: null,
      postId: null,
      groupKey: null,
    })

    expect(findUsernameCalled).toBe(false)
    expect(sent[0]).toEqual({ title: 'X', body: 'Alguien empezó a seguirte', url: null })
  })

  it('falls back to a profile link when there is no post to link to', async () => {
    const userId = generateId()
    const sent: PushPayload[] = []
    const process = createNotificationsProcessor({
      repository: createFakeRepository({
        isPushEnabled: async () => true,
        findPushSubscriptions: async () => [{ endpoint: 'e', p256dh: 'p', authKey: 'a' }],
        findUsername: async () => 'ana',
      }),
      redis: redis.redis,
      sendPush: async (_subscription, payload) => {
        sent.push(payload)
        return { expired: false }
      },
    })

    await process({
      userId: userId.toString(),
      kind: 'follow',
      actorId: '2',
      postId: null,
      groupKey: null,
    })

    expect(sent[0]?.url).toBe('/ana')
  })
})
