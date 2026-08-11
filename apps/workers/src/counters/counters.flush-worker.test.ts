import { postCountersKey } from '@x/utils'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCountersFlushWorker } from './counters.flush-worker.js'
import type { CountersRepository } from './counters.repository.js'

// Hand-rolled — models only SPOP/HGETALL, the two commands the flush
// worker actually issues.
function createFakeRedis() {
  const dirty = new Set<string>()
  const hashes = new Map<string, Record<string, string>>()

  const redis = {
    async spop(_key: string, count: number) {
      const popped = [...dirty].slice(0, count)
      for (const id of popped) dirty.delete(id)
      return popped
    },
    async hgetall(key: string) {
      return hashes.get(key) ?? {}
    },
  } as unknown as Redis

  return {
    redis,
    markDirty(postId: string, hash: Record<string, string>) {
      dirty.add(postId)
      hashes.set(postCountersKey(postId), hash)
    },
  }
}

function createFakeRepository() {
  const flushed: Array<{ postId: bigint; counters: unknown }> = []
  const repository: CountersRepository = {
    async flushCounters(postId, counters) {
      flushed.push({ postId, counters })
    },
    async reconcileRecentPosts() {},
  }
  return { repository, flushed }
}

describe('createCountersFlushWorker', () => {
  let fakeRedis: ReturnType<typeof createFakeRedis>
  let fakeRepository: ReturnType<typeof createFakeRepository>

  beforeEach(() => {
    fakeRedis = createFakeRedis()
    fakeRepository = createFakeRepository()
  })

  it('flushes every dirty post to the repository', async () => {
    fakeRedis.markDirty('1', {
      likes: '3',
      reposts: '0',
      replies: '0',
      quotes: '0',
      bookmarks: '1',
    })
    fakeRedis.markDirty('2', {
      likes: '5',
      reposts: '1',
      replies: '0',
      quotes: '0',
      bookmarks: '0',
    })
    const worker = createCountersFlushWorker(fakeRepository.repository, fakeRedis.redis, 5_000)

    const count = await worker.flushOnce()

    expect(count).toBe(2)
    expect(fakeRepository.flushed).toEqual(
      expect.arrayContaining([
        { postId: 1n, counters: { likes: 3, reposts: 0, replies: 0, quotes: 0, bookmarks: 1 } },
        { postId: 2n, counters: { likes: 5, reposts: 1, replies: 0, quotes: 0, bookmarks: 0 } },
      ]),
    )
  })

  it('skips a claimed id whose hash is already gone', async () => {
    fakeRedis.markDirty('1', {}) // e.g. evicted between SADD and this flush
    const worker = createCountersFlushWorker(fakeRepository.repository, fakeRedis.redis, 5_000)

    const count = await worker.flushOnce()

    expect(count).toBe(1) // still claimed and consumed from the dirty set
    expect(fakeRepository.flushed).toEqual([])
  })

  it('returns 0 when nothing is dirty', async () => {
    const worker = createCountersFlushWorker(fakeRepository.repository, fakeRedis.redis, 5_000)
    expect(await worker.flushOnce()).toBe(0)
  })

  it('runs flushOnce on an interval once started, and stops cleanly', async () => {
    vi.useFakeTimers()
    fakeRedis.markDirty('1', {
      likes: '1',
      reposts: '0',
      replies: '0',
      quotes: '0',
      bookmarks: '0',
    })
    const worker = createCountersFlushWorker(fakeRepository.repository, fakeRedis.redis, 1_000)

    worker.start()
    await vi.advanceTimersByTimeAsync(1_000)
    worker.stop()
    fakeRedis.markDirty('2', {
      likes: '1',
      reposts: '0',
      replies: '0',
      quotes: '0',
      bookmarks: '0',
    })
    await vi.advanceTimersByTimeAsync(5_000)

    expect(fakeRepository.flushed.map((f) => f.postId)).toEqual([1n]) // post 2 never flushed — worker was stopped
    vi.useRealTimers()
  })
})
