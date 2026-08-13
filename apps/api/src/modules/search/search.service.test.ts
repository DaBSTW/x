import type { Post } from '@x/contracts'
import { describe, expect, it, vi } from 'vitest'
import { encodeSearchCursor } from './cursor.js'
import type { OpenSearchQueryBody } from './query-builder.js'
import type { SearchHit, SearchRepository } from './search.repository.js'
import {
  type FollowingLookup,
  type PeopleHydrator,
  type PeopleRow,
  createSearchService,
} from './search.service.js'

function fakePost(id: string, overrides: Partial<Post> = {}): Post {
  return {
    id,
    text: 'hola',
    createdAt: new Date().toISOString(),
    author: { id: '1', username: 'ana', displayName: 'Ana', avatarUrl: null, isVerified: false },
    entities: [],
    media: [],
    conversationId: id,
    inReplyToId: null,
    counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
    quotedPost: null,
    ...overrides,
  }
}

function hit(id: string, sortValues: (string | number)[] = [0, id]): SearchHit {
  return { id, sortValues }
}

function createFakeRepository(overrides: Partial<SearchRepository> = {}): SearchRepository {
  return {
    searchPosts: vi.fn(async () => ({ hits: [], hasMore: false })),
    searchUsers: vi.fn(async () => ({ hits: [], hasMore: false })),
    typeaheadUsers: vi.fn(async () => []),
    typeaheadHashtags: vi.fn(async () => []),
    ...overrides,
  }
}

describe('createSearchService', () => {
  it('hydrates posts in the exact ranked order OpenSearch returned, not database order', async () => {
    const repository = createFakeRepository({
      searchPosts: vi.fn(async () => ({ hits: [hit('3'), hit('1'), hit('2')], hasMore: false })),
    })
    const getManyByIds = vi.fn(async (ids: bigint[]) => ids.map((id) => fakePost(id.toString())))
    const service = createSearchService(
      repository,
      { getManyByIds },
      {
        findManyByIds: async () => [],
      },
    )

    const page = await service.search('gato', 'latest', 20, undefined)

    expect(getManyByIds).toHaveBeenCalledWith([3n, 1n, 2n], undefined)
    expect((page.items as Post[]).map((post) => post.id)).toEqual(['3', '1', '2'])
  })

  it('applies viewer state (liked/reposted/bookmarked) only when authenticated and a viewerState lookup is configured', async () => {
    const repository = createFakeRepository({
      searchPosts: vi.fn(async () => ({ hits: [hit('1')], hasMore: false })),
    })
    const getManyByIds = vi.fn(async (ids: bigint[]) => ids.map((id) => fakePost(id.toString())))
    const service = createSearchService(
      repository,
      { getManyByIds },
      { findManyByIds: async () => [] },
      {
        findLikedPostIds: async () => new Set([1n]),
        findBookmarkedPostIds: async () => new Set(),
        findRepostedPostIds: async () => new Set(),
      },
    )

    const anonymous = await service.search('gato', 'latest', 20, undefined)
    expect((anonymous.items[0] as Post).viewer).toBeUndefined()

    const authenticated = await service.search('gato', 'latest', 20, undefined, 42n)
    expect((authenticated.items[0] as Post).viewer).toEqual({
      liked: true,
      bookmarked: false,
      reposted: false,
    })
  })

  it('only fetches the social-affinity following list for top mode, and only when authenticated', async () => {
    const findFolloweeIds = vi.fn(async () => [10n, 20n])
    const followingLookup: FollowingLookup = { findFolloweeIds }
    const repository = createFakeRepository()
    const service = createSearchService(
      repository,
      { getManyByIds: async () => [] },
      { findManyByIds: async () => [] },
      undefined,
      undefined,
      followingLookup,
    )

    await service.search('gato', 'latest', 20, undefined, 1n)
    expect(findFolloweeIds).not.toHaveBeenCalled()

    await service.search('gato', 'top', 20, undefined) // anonymous
    expect(findFolloweeIds).not.toHaveBeenCalled()

    await service.search('gato', 'top', 20, undefined, 1n)
    expect(findFolloweeIds).toHaveBeenCalledWith(1n, 500)
    const call = (repository.searchPosts as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
      query: { function_score: { functions: Record<string, unknown>[] } }
    }
    expect(call.query.function_score.functions).toContainEqual({
      filter: { terms: { author_id: ['10', '20'] } },
      weight: 2,
    })
  })

  it('returns a null nextCursor when there is no more, and a decodable one when there is', async () => {
    const repository = createFakeRepository({
      searchPosts: vi.fn(async () => ({ hits: [hit('1', [5, '1'])], hasMore: true })),
    })
    const service = createSearchService(
      repository,
      { getManyByIds: async (ids: bigint[]) => ids.map((id) => fakePost(id.toString())) },
      { findManyByIds: async () => [] },
    )

    const page = await service.search('gato', 'latest', 20, undefined)
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).not.toBeNull()

    const noMore = createSearchService(
      createFakeRepository({
        searchPosts: vi.fn(async () => ({ hits: [hit('1')], hasMore: false })),
      }),
      { getManyByIds: async (ids: bigint[]) => ids.map((id) => fakePost(id.toString())) },
      { findManyByIds: async () => [] },
    )
    expect((await noMore.search('gato', 'latest', 20, undefined)).nextCursor).toBeNull()
  })

  it('decodes an incoming cursor into search_after and passes it through to the repository', async () => {
    const repository = createFakeRepository()
    const service = createSearchService(
      repository,
      { getManyByIds: async () => [] },
      { findManyByIds: async () => [] },
    )
    const cursor = encodeSearchCursor(['2026-01-01T00:00:00.000Z', '99'])

    await service.search('gato', 'latest', 20, cursor)

    const call = (repository.searchPosts as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
      search_after?: unknown
    }
    expect(call.search_after).toEqual(['2026-01-01T00:00:00.000Z', '99'])
  })

  it('people mode hydrates users in ranked order and drops anyone the viewer has blocked (either direction)', async () => {
    const rows: PeopleRow[] = [
      { id: 1n, username: 'ana', displayName: 'Ana', avatarUrl: null, isVerified: false },
      { id: 2n, username: 'bob', displayName: 'Bob', avatarUrl: null, isVerified: false },
    ]
    const peopleHydrator: PeopleHydrator = { findManyByIds: async () => rows }
    const repository = createFakeRepository({
      searchUsers: vi.fn(async () => ({ hits: [hit('2'), hit('1')], hasMore: false })),
    })
    const service = createSearchService(
      repository,
      { getManyByIds: async () => [] },
      peopleHydrator,
      undefined,
      { findBlockedAuthorIds: async () => new Set([1n]) },
    )

    const page = await service.search('a', 'people', 20, undefined, 99n)
    expect(page.items).toEqual([
      { id: '2', username: 'bob', displayName: 'Bob', avatarUrl: null, isVerified: false },
    ])
  })

  it('people mode never calls the posts hydrator, and vice versa', async () => {
    const getManyByIds = vi.fn(async () => [])
    const findManyByIds = vi.fn(async () => [])
    const repository = createFakeRepository()
    const service = createSearchService(repository, { getManyByIds }, { findManyByIds })

    await service.search('a', 'people', 20, undefined)
    expect(getManyByIds).not.toHaveBeenCalled()
    expect(findManyByIds).toHaveBeenCalled()

    findManyByIds.mockClear()
    await service.search('a', 'top', 20, undefined)
    expect(findManyByIds).not.toHaveBeenCalled()
  })

  it('media mode requests has_media:true even when the caller typed no filter operator', async () => {
    const repository = createFakeRepository()
    const service = createSearchService(
      repository,
      { getManyByIds: async () => [] },
      { findManyByIds: async () => [] },
    )

    await service.search('gato', 'media', 20, undefined)
    const call = (repository.searchPosts as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
      query: { bool: { filter: unknown[] } }
    }
    expect(call.query.bool.filter).toContainEqual({ term: { has_media: true } })
  })

  describe('typeahead', () => {
    it('strips a leading #/@ before matching, since neither is part of the actual prefix', async () => {
      const typeaheadUsers = vi.fn(async (_body: OpenSearchQueryBody): Promise<string[]> => [])
      const typeaheadHashtags = vi.fn(async (_body: OpenSearchQueryBody): Promise<string[]> => [])
      const repository = createFakeRepository({ typeaheadUsers, typeaheadHashtags })
      const service = createSearchService(
        repository,
        { getManyByIds: async () => [] },
        { findManyByIds: async () => [] },
      )

      // Both indices are queried on every call regardless of the '#'/'@'
      // prefix — typeahead doesn't guess intent server-side, it hands the
      // caller both users and hashtags and lets the UI decide what to show.
      await service.typeahead('@ana', 10)
      expect(typeaheadUsers.mock.calls.at(-1)?.[0]).toMatchObject({
        query: {
          bool: { should: [{ match: { username: 'ana' } }, { match: { display_name: 'ana' } }] },
        },
      })

      await service.typeahead('#mun', 10)
      expect(typeaheadHashtags.mock.calls.at(-1)?.[0]).toMatchObject({
        query: { prefix: { hashtags: 'mun' } },
      })
    })

    it('returns empty results for an empty or whitespace/operator-only prefix, without ever querying OpenSearch', async () => {
      const typeaheadUsers = vi.fn(async () => [])
      const typeaheadHashtags = vi.fn(async () => [])
      const repository = createFakeRepository({ typeaheadUsers, typeaheadHashtags })
      const service = createSearchService(
        repository,
        { getManyByIds: async () => [] },
        { findManyByIds: async () => [] },
      )

      const page = await service.typeahead('  ', 10)
      expect(page).toEqual({ users: [], hashtags: [] })
      expect(typeaheadUsers).not.toHaveBeenCalled()
      expect(typeaheadHashtags).not.toHaveBeenCalled()
    })

    it('hydrates matched user ids and drops anyone the viewer has blocked, same as people mode', async () => {
      const rows: PeopleRow[] = [
        { id: 1n, username: 'ana', displayName: 'Ana', avatarUrl: null, isVerified: false },
        { id: 2n, username: 'ana2', displayName: 'Ana Two', avatarUrl: null, isVerified: false },
      ]
      const peopleHydrator: PeopleHydrator = { findManyByIds: async () => rows }
      const repository = createFakeRepository({
        typeaheadUsers: vi.fn(async () => ['2', '1']),
      })
      const service = createSearchService(
        repository,
        { getManyByIds: async () => [] },
        peopleHydrator,
        undefined,
        { findBlockedAuthorIds: async () => new Set([1n]) },
      )

      const page = await service.typeahead('ana', 10, 99n)
      expect(page.users).toEqual([
        { id: '2', username: 'ana2', displayName: 'Ana Two', avatarUrl: null, isVerified: false },
      ])
    })

    it('returns the hashtag aggregation results as-is, in the order the repository gave them', async () => {
      const repository = createFakeRepository({
        typeaheadHashtags: vi.fn(async () => ['mundial2026', 'mundo']),
      })
      const service = createSearchService(
        repository,
        { getManyByIds: async () => [] },
        { findManyByIds: async () => [] },
      )

      const page = await service.typeahead('mun', 10)
      expect(page.hashtags).toEqual(['mundial2026', 'mundo'])
    })
  })
})
