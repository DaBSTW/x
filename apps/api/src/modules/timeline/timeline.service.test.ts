import type { Post } from '@x/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { TimelineRepository } from './timeline.repository.js'
import { type PostHydrator, createTimelineService } from './timeline.service.js'

function makePost(id: bigint, authorId = 1n): Post {
  return {
    id: id.toString(),
    text: `post ${id}`,
    createdAt: new Date().toISOString(),
    author: {
      id: authorId.toString(),
      username: 'ana',
      displayName: 'Ana',
      avatarUrl: null,
      isVerified: false,
    },
    entities: [],
    media: [],
    conversationId: id.toString(),
    inReplyToId: null,
    counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
    quotedPost: null,
  }
}

/** `authorIdByPostId` defaults every post to author `1n` — only the mute-filtering tests below need more than one author. */
function createFakeHydrator(authorIdByPostId: Map<bigint, bigint> = new Map()): PostHydrator {
  return {
    async getManyByIds(ids) {
      return ids.map((id) => makePost(id, authorIdByPostId.get(id) ?? 1n))
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

  it('hydrates viewer state per post when a lookup is provided', async () => {
    const repository = createFakeRepository({ readPrecomputed: async () => [30n, 20n, 10n] })
    const service = createTimelineService(repository, createFakeHydrator(), {
      findLikedPostIds: async () => new Set([30n]),
      findBookmarkedPostIds: async () => new Set([10n]),
      findRepostedPostIds: async () => new Set(),
    })

    const { items } = await service.getHome(1n, 20, null)

    expect(items.map((post) => post.viewer)).toEqual([
      { liked: true, bookmarked: false, reposted: false },
      { liked: false, bookmarked: false, reposted: false },
      { liked: false, bookmarked: true, reposted: false },
    ])
  })

  it('leaves viewer undefined without a lookup', async () => {
    const repository = createFakeRepository({ readPrecomputed: async () => [30n] })
    const service = createTimelineService(repository, createFakeHydrator())

    const { items } = await service.getHome(1n, 20, null)

    expect(items[0]?.viewer).toBeUndefined()
  })

  describe('mute filtering (ROADMAP.md 2.6)', () => {
    it('drops a post from a muted author out of the passive feed', async () => {
      const repository = createFakeRepository({ readPrecomputed: async () => [30n, 20n, 10n] })
      const authorIdByPostId = new Map([[20n, 2n]])
      const service = createTimelineService(
        repository,
        createFakeHydrator(authorIdByPostId),
        undefined,
        { findMutedAuthorIds: async () => new Set([2n]) },
      )

      const { items } = await service.getHome(1n, 20, null)

      expect(items.map((post) => post.id)).toEqual(['30', '10'])
    })

    it('leaves every post when nothing is muted', async () => {
      const repository = createFakeRepository({ readPrecomputed: async () => [30n, 20n] })
      const service = createTimelineService(repository, createFakeHydrator(), undefined, {
        findMutedAuthorIds: async () => new Set(),
      })

      const { items } = await service.getHome(1n, 20, null)

      expect(items.map((post) => post.id)).toEqual(['30', '20'])
    })

    it('skips filtering entirely without a lookup', async () => {
      const repository = createFakeRepository({ readPrecomputed: async () => [30n] })
      const service = createTimelineService(repository, createFakeHydrator())

      const { items } = await service.getHome(1n, 20, null)

      expect(items.map((post) => post.id)).toEqual(['30'])
    })
  })

  describe('getBookmarks', () => {
    it('hydrates the bookmarked ids, newest first, with viewer state attached', async () => {
      const repository = createFakeRepository()
      const service = createTimelineService(
        repository,
        createFakeHydrator(),
        {
          findLikedPostIds: async () => new Set(),
          findBookmarkedPostIds: async () => new Set([30n, 10n]),
          findRepostedPostIds: async () => new Set(),
        },
        undefined,
        { listBookmarkedPostIds: async () => [30n, 10n] },
      )

      const { items } = await service.getBookmarks(1n, 20, null)

      expect(items.map((post) => post.id)).toEqual(['30', '10'])
      expect(items.map((post) => post.viewer?.bookmarked)).toEqual([true, true])
    })

    it('reports hasMore from the lookup, one page at a time', async () => {
      const repository = createFakeRepository()
      const service = createTimelineService(
        repository,
        createFakeHydrator(),
        undefined,
        undefined,
        { listBookmarkedPostIds: async () => [30n, 20n, 10n] },
      )

      const { items, hasMore } = await service.getBookmarks(1n, 2, null)

      expect(items.map((post) => post.id)).toEqual(['30', '20'])
      expect(hasMore).toBe(true)
    })

    it('throws when no bookmarksLookup was configured at all', async () => {
      const repository = createFakeRepository()
      const service = createTimelineService(repository, createFakeHydrator())

      await expect(service.getBookmarks(1n, 20, null)).rejects.toThrow(/bookmarksLookup/)
    })
  })
})
