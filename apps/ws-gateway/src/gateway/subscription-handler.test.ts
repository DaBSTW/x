import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it } from 'vitest'
import { createConnectionRegistry } from './connection-registry.js'
import { createSubscriptionHandler } from './subscription-handler.js'

// Hand-rolled — models only subscribe/unsubscribe, the two commands this
// handler actually issues, same convention as apps/api's createFakeRedis
// test helpers.
function createFakeSubscriber() {
  const calls: Array<{ op: 'subscribe' | 'unsubscribe'; channel: string }> = []
  const subscriber: Pick<Redis, 'subscribe' | 'unsubscribe'> = {
    subscribe: (async (channel: string) => {
      calls.push({ op: 'subscribe', channel })
      return 1
    }) as Redis['subscribe'],
    unsubscribe: (async (channel: string) => {
      calls.push({ op: 'unsubscribe', channel })
      return 1
    }) as Redis['unsubscribe'],
  }
  return { subscriber, calls }
}

function createFakeRepository(members: Set<string>) {
  return {
    async isConversationMember(conversationId: bigint, userId: bigint) {
      return members.has(`${conversationId}:${userId}`)
    },
  }
}

/** Models a stream holding one entry per channel, keyed by channel — enough to prove replayMissedEvents gets called with the right (channel, sinceId), without re-testing its own XRANGE parsing (stream-replay.test.ts already does). */
function createFakeRedis(
  streamEntryByChannel: Record<string, [string, string[]]>,
): Pick<Redis, 'xrange'> {
  return {
    xrange: (async (key: string, _start: string, ..._rest: unknown[]) => {
      const channel = key.replace('realtime:stream:', '')
      const entry = streamEntryByChannel[channel]
      return entry ? [entry] : []
    }) as Redis['xrange'],
  }
}

describe('createSubscriptionHandler', () => {
  let registry: ReturnType<typeof createConnectionRegistry>

  beforeEach(() => {
    registry = createConnectionRegistry()
  })

  it('applies authorized channels and issues a Redis SUBSCRIBE only for the first local connection on each', async () => {
    const { subscriber, calls } = createFakeSubscriber()
    const handler = createSubscriptionHandler({
      registry,
      repository: createFakeRepository(new Set()),
      subscriber,
      redis: createFakeRedis({}),
    })

    const first = await handler.subscribe('conn-1', 123n, ['user:123', 'timeline:123'])
    expect(first).toEqual({ applied: ['user:123', 'timeline:123'], denied: [], replay: [] })
    expect(calls).toEqual([
      { op: 'subscribe', channel: 'user:123' },
      { op: 'subscribe', channel: 'timeline:123' },
    ])

    // A second connection joining a channel already live on this process
    // must not re-issue SUBSCRIBE — the registry already tracks it.
    const second = await handler.subscribe('conn-2', 456n, ['post:999'])
    await handler.subscribe('conn-3', 456n, ['post:999'])
    expect(second.applied).toEqual(['post:999'])
    expect(calls.filter((c) => c.channel === 'post:999')).toHaveLength(1)
  })

  it('denies unauthorized channels without subscribing to them', async () => {
    const { subscriber, calls } = createFakeSubscriber()
    const handler = createSubscriptionHandler({
      registry,
      repository: createFakeRepository(new Set()),
      subscriber,
      redis: createFakeRedis({}),
    })

    const result = await handler.subscribe('conn-1', 123n, ['user:456'])
    expect(result).toEqual({ applied: [], denied: ['user:456'], replay: [] })
    expect(calls).toEqual([])
    expect(registry.connectionsFor('user:456')).toEqual(new Set())
  })

  it('mixes applied and denied channels in one request independently', async () => {
    const { subscriber } = createFakeSubscriber()
    const handler = createSubscriptionHandler({
      registry,
      repository: createFakeRepository(new Set(['555:123'])),
      subscriber,
      redis: createFakeRedis({}),
    })

    const result = await handler.subscribe('conn-1', 123n, ['user:123', 'user:456', 'conv:555'])
    expect(result.applied.sort()).toEqual(['conv:555', 'user:123'])
    expect(result.denied).toEqual(['user:456'])
  })

  it('replays missed events for a channel subscribed to with a since id (ROADMAP.md 2.2 recovery)', async () => {
    const { subscriber } = createFakeSubscriber()
    const entry: [string, string[]] = [
      '200-0',
      ['event', 'post.available', 'data', '{"postId":"1"}'],
    ]
    const handler = createSubscriptionHandler({
      registry,
      repository: createFakeRepository(new Set()),
      subscriber,
      redis: createFakeRedis({ 'timeline:123': entry }),
    })

    const result = await handler.subscribe('conn-1', 123n, ['timeline:123'], {
      'timeline:123': '100-0',
    })

    expect(result.applied).toEqual(['timeline:123'])
    expect(result.replay).toHaveLength(1)
    expect(result.replay[0]?.channel).toBe('timeline:123')
    expect(result.replay[0]?.events).toHaveLength(1)
    expect(result.replay[0]?.events[0]?.id).toBe('200-0')
  })

  it('does not replay for a channel subscribed to without a since id', async () => {
    const { subscriber } = createFakeSubscriber()
    const entry: [string, string[]] = ['200-0', ['event', 'post.available', 'data', '{}']]
    const handler = createSubscriptionHandler({
      registry,
      repository: createFakeRepository(new Set()),
      subscriber,
      redis: createFakeRedis({ 'timeline:123': entry }),
    })

    const result = await handler.subscribe('conn-1', 123n, ['timeline:123'])

    expect(result.replay).toEqual([])
  })

  it('never replays for a channel that was denied, even if a since id was given for it', async () => {
    const { subscriber } = createFakeSubscriber()
    const entry: [string, string[]] = ['200-0', ['event', 'post.available', 'data', '{}']]
    const handler = createSubscriptionHandler({
      registry,
      repository: createFakeRepository(new Set()),
      subscriber,
      redis: createFakeRedis({ 'user:456': entry }),
    })

    const result = await handler.subscribe('conn-1', 123n, ['user:456'], { 'user:456': '100-0' })

    expect(result.denied).toEqual(['user:456'])
    expect(result.replay).toEqual([])
  })

  it('issues Redis UNSUBSCRIBE exactly when the last local connection on a channel leaves', async () => {
    const { subscriber, calls } = createFakeSubscriber()
    const handler = createSubscriptionHandler({
      registry,
      repository: createFakeRepository(new Set()),
      subscriber,
      redis: createFakeRedis({}),
    })
    registry.subscribe('conn-1', 'post:1') // two connections sharing one channel, bypassing authorization (post: allows anyone anyway)
    registry.subscribe('conn-2', 'post:1')

    calls.length = 0
    expect(await handler.unsubscribe('conn-1', ['post:1'])).toEqual(['post:1'])
    expect(calls).toEqual([]) // conn-2 still there

    expect(await handler.unsubscribe('conn-2', ['post:1'])).toEqual(['post:1'])
    expect(calls).toEqual([{ op: 'unsubscribe', channel: 'post:1' }])
  })

  it('disconnect tears down every channel a connection was on, unsubscribing from Redis only for the ones left empty', async () => {
    const { subscriber, calls } = createFakeSubscriber()
    const handler = createSubscriptionHandler({
      registry,
      repository: createFakeRepository(new Set()),
      subscriber,
      redis: createFakeRedis({}),
    })
    registry.subscribe('conn-1', 'post:1')
    registry.subscribe('conn-1', 'post:2')
    registry.subscribe('conn-2', 'post:2') // survives conn-1's disconnect

    calls.length = 0
    await handler.disconnect('conn-1')

    expect(calls).toEqual([{ op: 'unsubscribe', channel: 'post:1' }])
    expect(registry.channelsFor('conn-1')).toEqual(new Set())
    expect(registry.connectionsFor('post:2')).toEqual(new Set(['conn-2']))
  })
})
