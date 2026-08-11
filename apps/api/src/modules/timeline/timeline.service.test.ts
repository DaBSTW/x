import type { Post } from '@x/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { TimelineRepository } from './timeline.repository.js'
import { type PostHydrator, createTimelineService } from './timeline.service.js'

function makePost(id: bigint): Post {
  return {
    id: id.toString(),
    text: `post ${id}`,
    createdAt: new Date().toISOString(),
    author: { id: '1', username: 'ana', displayName: 'Ana', avatarUrl: null, isVerified: false },
    entities: [],
    conversationId: id.toString(),
    inReplyToId: null,
    counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
  }
}

function createFakeHydrator(): PostHydrator {
  return {
    async getManyByIds(ids) {
      return ids.map(makePost)
    },
  }
}

function createFakeRepository(overrides: Partial<TimelineRepository> = {}): TimelineRepository {
  return {
    timelineExists: async () => true,
    readPrecomputed: async () => [],
    reconstructFromPostgres: async () => [],
    listRecentFromCelebrityFollowees: async () => [],
    ...overrides,
  }
}

describe('createTimelineService', () => {
  it('returns the precomputed timeline merged with celebrity posts, newest first', async () => {
    const repository = createFakeRepository({
      readPrecomputed: async () => [30n, 10n],
      listRecentFromCelebrityFollowees: async () => [20n],
    })
    const service = createTimelineService(repository, createFakeHydrator())

    const { items, hasMore } = await service.getHome(1n, 20, null)

    expect(items.map((post) => post.id)).toEqual(['30', '20', '10'])
    expect(hasMore).toBe(false)
  })

  it('deduplicates an id present in both sources', async () => {
    const repository = createFakeRepository({
      readPrecomputed: async () => [30n, 20n],
      listRecentFromCelebrityFollowees: async () => [20n, 10n],
    })
    const service = createTimelineService(repository, createFakeHydrator())

    const { items } = await service.getHome(1n, 20, null)

    expect(items.map((post) => post.id)).toEqual(['30', '20', '10'])
  })

  it('reports hasMore when the merged page exceeds the requested limit', async () => {
    const repository = createFakeRepository({
      readPrecomputed: async () => [30n, 20n, 10n],
    })
    const service = createTimelineService(repository, createFakeHydrator())

    const { items, hasMore } = await service.getHome(1n, 2, null)

    expect(items.map((post) => post.id)).toEqual(['30', '20'])
    expect(hasMore).toBe(true)
  })

  it('reconstructs from Postgres only when the timeline is both empty and missing', async () => {
    const reconstructFromPostgres = vi.fn(async () => [50n, 40n])
    const repository = createFakeRepository({
      readPrecomputed: async () => [],
      timelineExists: async () => false,
      reconstructFromPostgres,
    })
    const service = createTimelineService(repository, createFakeHydrator())

    const { items } = await service.getHome(1n, 20, null)

    expect(reconstructFromPostgres).toHaveBeenCalledOnce()
    expect(items.map((post) => post.id)).toEqual(['50', '40'])
  })

  it('does not reconstruct when an empty read means "nothing left", not "cold"', async () => {
    const reconstructFromPostgres = vi.fn(async () => [50n, 40n])
    const repository = createFakeRepository({
      readPrecomputed: async () => [],
      timelineExists: async () => true,
      reconstructFromPostgres,
    })
    const service = createTimelineService(repository, createFakeHydrator())

    const { items } = await service.getHome(1n, 20, null)

    expect(reconstructFromPostgres).not.toHaveBeenCalled()
    expect(items).toEqual([])
  })

  it('applies the cursor to a reconstructed timeline', async () => {
    const repository = createFakeRepository({
      readPrecomputed: async () => [],
      timelineExists: async () => false,
      reconstructFromPostgres: async () => [50n, 40n, 30n],
    })
    const service = createTimelineService(repository, createFakeHydrator())

    const { items } = await service.getHome(1n, 20, 40n)

    expect(items.map((post) => post.id)).toEqual(['30'])
  })
})
