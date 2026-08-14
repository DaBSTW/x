import {
  CELEBRITY_FOLLOWER_THRESHOLD,
  realtimeStreamKey,
  timelineChannel,
  timelineKey,
} from '@x/utils'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it } from 'vitest'
import { createFanoutProcessor } from './fanout.processor.js'
import type { FanoutRepository } from './fanout.repository.js'

type PipelineCommand = ['zadd' | 'zremrangebyrank' | 'expire' | 'xadd' | 'publish', ...unknown[]]

// Hand-rolled, recording only the pipelined commands the processor actually
// issues — real Redis ZADD/ZREMRANGEBYRANK/EXPIRE/XADD/PUBLISH semantics
// are exercised by fanout.integration.test.ts against a real container.
// exec() fakes ioredis's own [error, result][] shape, assigning each XADD a
// distinct id — the processor reads that id back to build eventId, so a
// fake that always returned the same value would hide a real bug.
function createFakeRedis() {
  const strings = new Map<string, string>()
  const executed: PipelineCommand[] = []
  let nextStreamSeq = 0

  const redis = {
    async set(key: string, value: string, ...rest: unknown[]) {
      if (rest.includes('NX') && strings.has(key)) return null
      strings.set(key, value)
      return 'OK'
    },
    async exists(key: string) {
      return strings.has(key) ? 1 : 0
    },
    pipeline() {
      const batch: PipelineCommand[] = []
      const api = {
        zadd(...args: unknown[]) {
          batch.push(['zadd', ...args])
          return api
        },
        zremrangebyrank(...args: unknown[]) {
          batch.push(['zremrangebyrank', ...args])
          return api
        },
        expire(...args: unknown[]) {
          batch.push(['expire', ...args])
          return api
        },
        xadd(...args: unknown[]) {
          batch.push(['xadd', ...args])
          return api
        },
        publish(...args: unknown[]) {
          batch.push(['publish', ...args])
          return api
        },
        async exec(): Promise<Array<[Error | null, unknown]>> {
          executed.push(...batch)
          return batch.map((command) => {
            if (command[0] === 'xadd') {
              nextStreamSeq += 1
              return [null, `1723456789000-${nextStreamSeq}`]
            }
            return [null, 'OK']
          })
        },
      }
      return api
    },
  } as unknown as Redis

  return { redis, executed }
}

function createFakeRepository(overrides: Partial<FanoutRepository> = {}): FanoutRepository {
  return {
    getFollowersCount: async () => 0,
    listFollowerIdsBatch: async () => [],
    ...overrides,
  }
}

describe('createFanoutProcessor', () => {
  let fakeRedis: ReturnType<typeof createFakeRedis>

  beforeEach(() => {
    fakeRedis = createFakeRedis()
  })

  it('pushes the post onto every follower timeline', async () => {
    const followerIds = [10n, 11n, 12n]
    const repository = createFakeRepository({
      getFollowersCount: async () => 3,
      listFollowerIdsBatch: async (_authorId, afterId) => (afterId === null ? followerIds : []),
    })
    const process = createFanoutProcessor({ repository, redis: fakeRedis.redis })

    await process({ postId: '999', authorId: '1' })

    const zaddCalls = fakeRedis.executed.filter(([op]) => op === 'zadd')
    expect(zaddCalls).toHaveLength(3)
    for (const followerId of followerIds) {
      expect(zaddCalls).toContainEqual(['zadd', timelineKey(followerId), '999', '999'])
    }
  })

  it("publishes a post.available event on every follower's timeline channel, carrying the id its own stream entry was assigned (ROADMAP.md 2.2 badge)", async () => {
    const followerIds = [10n, 11n]
    const repository = createFakeRepository({
      getFollowersCount: async () => 2,
      listFollowerIdsBatch: async (_authorId, afterId) => (afterId === null ? followerIds : []),
    })
    const process = createFanoutProcessor({ repository, redis: fakeRedis.redis })

    await process({ postId: '999', authorId: '1' })

    const xaddCalls = fakeRedis.executed.filter(
      (command): command is ['xadd', ...unknown[]] => command[0] === 'xadd',
    )
    const publishCalls = fakeRedis.executed.filter(
      (command): command is ['publish', string, string] => command[0] === 'publish',
    )
    expect(publishCalls).toHaveLength(2)
    for (const [index, followerId] of followerIds.entries()) {
      const publishCall = publishCalls.find(
        ([, channel]) => channel === timelineChannel(followerId),
      )
      expect(publishCall).toBeDefined()
      const [, , payload] = publishCall as ['publish', string, string]
      const event = JSON.parse(payload)
      expect(event).toMatchObject({
        op: 'event',
        channel: timelineChannel(followerId),
        event: 'post.available',
        data: { postId: '999' },
      })
      // Not a value the processor invented itself — the exact id the fake's
      // exec() assigned this follower's own XADD, in call order.
      const xaddCall = xaddCalls[index]
      expect(xaddCall).toBeDefined()
      expect(event.eventId).toBe(`1723456789000-${index + 1}`)
    }
  })

  it("XADDs each event to the follower's own stream key, MINID-trimmed to the retention window", async () => {
    const followerIds = [10n]
    const repository = createFakeRepository({
      getFollowersCount: async () => 1,
      listFollowerIdsBatch: async (_authorId, afterId) => (afterId === null ? followerIds : []),
    })
    const process = createFanoutProcessor({ repository, redis: fakeRedis.redis })

    await process({ postId: '999', authorId: '1' })

    const xaddCalls = fakeRedis.executed.filter(([op]) => op === 'xadd')
    expect(xaddCalls).toHaveLength(1)
    const [
      ,
      key,
      minidToken,
      approxToken,
      cutoff,
      star,
      eventField,
      eventValue,
      dataField,
      payload,
    ] = xaddCalls[0] as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
    expect(key).toBe(realtimeStreamKey(timelineChannel(10n)))
    expect(minidToken).toBe('MINID')
    expect(approxToken).toBe('~')
    expect(cutoff).toMatch(/^\d+-0$/) // "<cutoff ms>-0", not a Snowflake id
    expect(star).toBe('*') // Redis assigns the real entry id
    expect(eventField).toBe('event')
    expect(eventValue).toBe('post.available')
    expect(dataField).toBe('data')
    expect(JSON.parse(payload)).toEqual({ postId: '999' })
  })

  it('skips fan-out for celebrity accounts', async () => {
    let called = false
    const repository = createFakeRepository({
      getFollowersCount: async () => CELEBRITY_FOLLOWER_THRESHOLD,
      listFollowerIdsBatch: async () => {
        called = true
        return []
      },
    })
    const process = createFanoutProcessor({ repository, redis: fakeRedis.redis })

    await process({ postId: '999', authorId: '1' })

    expect(called).toBe(false)
    expect(fakeRedis.executed).toHaveLength(0)
  })

  it('is idempotent: a repeated job for the same post is a no-op', async () => {
    let callCount = 0
    const repository = createFakeRepository({
      getFollowersCount: async () => {
        callCount += 1
        return 1
      },
      listFollowerIdsBatch: async (_authorId, afterId) => (afterId === null ? [10n] : []),
    })
    const process = createFanoutProcessor({ repository, redis: fakeRedis.redis })

    await process({ postId: '999', authorId: '1' })
    await process({ postId: '999', authorId: '1' })

    expect(callCount).toBe(1)
  })

  it('follows the follower-id cursor across batches', async () => {
    const seenCursors: Array<bigint | null> = []
    const repository = createFakeRepository({
      getFollowersCount: async () => 2,
      listFollowerIdsBatch: async (_authorId, afterId, limit) => {
        seenCursors.push(afterId)
        if (afterId === null) return Array.from({ length: limit }, (_, i) => BigInt(i + 1))
        return []
      },
    })
    const process = createFanoutProcessor({ repository, redis: fakeRedis.redis })

    await process({ postId: '999', authorId: '1' })

    expect(seenCursors).toEqual([null, 1000n])
  })
})
