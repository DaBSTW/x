import type { Post, SearchType } from '@x/contracts'
import type { PostsService, ViewerStateLookup } from '../posts/posts.service.js'
import type { FollowListItem } from '../social-graph/social-graph.service.js'
import { decodeSearchCursor, encodeSearchCursor } from './cursor.js'
import { buildPostsQueryBody, buildUsersQueryBody } from './query-builder.js'
import { parseSearchQuery } from './query-operators.js'
import type { SearchRepository } from './search.repository.js'

/** search.service.ts only ever needs to turn ranked ids into posts, not the full PostsService surface — same narrowing timeline.service.ts already does. */
export type PostHydrator = Pick<PostsService, 'getManyByIds'>

export type { ViewerStateLookup }

export type PeopleRow = {
  id: bigint
  username: string
  displayName: string
  avatarUrl: string | null
  isVerified: boolean
}

export type PeopleHydrator = {
  findManyByIds(ids: bigint[]): Promise<PeopleRow[]>
}

/** Structurally identical to social-graph.repository.ts's own method — no adapter needed, same pattern posts.service.ts/timeline.service.ts already use for their own optional lookups. */
export type BlockLookup = {
  findBlockedAuthorIds(viewerId: bigint, authorIds: bigint[]): Promise<Set<bigint>>
}

export type FollowingLookup = {
  findFolloweeIds(followerId: bigint, limit: number): Promise<bigint[]>
}

export type SearchService = ReturnType<typeof createSearchService>

export type SearchPage = {
  items: Post[] | FollowListItem[]
  hasMore: boolean
  nextCursor: string | null
}

// Capped, not the viewer's whole following list — see
// social-graph.repository.ts's findFolloweeIds docstring for why.
const FOLLOWING_AFFINITY_CAP = 500

export function createSearchService(
  repository: SearchRepository,
  postHydrator: PostHydrator,
  peopleHydrator: PeopleHydrator,
  viewerState?: ViewerStateLookup,
  blockLookup?: BlockLookup,
  followingLookup?: FollowingLookup,
) {
  async function withViewerState(items: Post[], viewerId?: bigint): Promise<Post[]> {
    if (!viewerState || viewerId === undefined) return items
    const ids = items.map((post) => BigInt(post.id))
    const [liked, bookmarked, reposted] = await Promise.all([
      viewerState.findLikedPostIds(viewerId, ids),
      viewerState.findBookmarkedPostIds(viewerId, ids),
      viewerState.findRepostedPostIds(viewerId, ids),
    ])
    return items.map((post) => ({
      ...post,
      viewer: {
        liked: liked.has(BigInt(post.id)),
        bookmarked: bookmarked.has(BigInt(post.id)),
        reposted: reposted.has(BigInt(post.id)),
      },
    }))
  }

  async function searchPeople(
    parsed: ReturnType<typeof parseSearchQuery>,
    limit: number,
    searchAfter: (string | number)[] | undefined,
    viewerId?: bigint,
  ): Promise<SearchPage> {
    const body = buildUsersQueryBody(parsed, searchAfter)
    const result = await repository.searchUsers(body, limit)
    const ids = result.hits.map((hit) => BigInt(hit.id))

    const [rows, blocked] = await Promise.all([
      peopleHydrator.findManyByIds(ids),
      viewerId !== undefined && blockLookup
        ? blockLookup.findBlockedAuthorIds(viewerId, ids)
        : Promise.resolve(new Set<bigint>()),
    ])
    const rowsById = new Map(rows.map((row) => [row.id, row]))

    // Re-sorted to `ids`' own ranked order — findManyByIds' `WHERE id IN
    // (...)` makes no promise about row order (same convention as
    // posts.repository.ts's findPostsByIds).
    const items: FollowListItem[] = []
    for (const id of ids) {
      const row = rowsById.get(id)
      if (!row || blocked.has(id)) continue
      items.push({
        id: row.id.toString(),
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        isVerified: row.isVerified,
      })
    }

    const lastHit = result.hits.at(-1)
    const nextCursor = result.hasMore && lastHit ? encodeSearchCursor(lastHit.sortValues) : null
    return { items, hasMore: result.hasMore, nextCursor }
  }

  async function searchPosts(
    parsed: ReturnType<typeof parseSearchQuery>,
    type: 'top' | 'latest' | 'media',
    limit: number,
    searchAfter: (string | number)[] | undefined,
    viewerId?: bigint,
  ): Promise<SearchPage> {
    const followingAuthorIds =
      type === 'top' && viewerId !== undefined && followingLookup
        ? (await followingLookup.findFolloweeIds(viewerId, FOLLOWING_AFFINITY_CAP)).map((id) =>
            id.toString(),
          )
        : []

    const body = buildPostsQueryBody(parsed, {
      type,
      followingAuthorIds,
      ...(searchAfter && { searchAfter }),
    })
    const result = await repository.searchPosts(body, limit)
    const ids = result.hits.map((hit) => BigInt(hit.id))

    // getManyByIds already: (a) preserves `ids`' own order, dropping any id
    // that's gone/hidden — exactly what a ranked result list needs, and (b)
    // applies block/protected-account filtering for free (ROADMAP.md 2.6's
    // own "se aplicará [a búsqueda] cuando se construya"). viewer
    // (liked/reposted/bookmarked) is a separate pass, same split
    // timeline.service.ts already uses.
    const hydrated = await postHydrator.getManyByIds(ids, viewerId)
    const items = await withViewerState(hydrated, viewerId)

    const lastHit = result.hits.at(-1)
    const nextCursor = result.hasMore && lastHit ? encodeSearchCursor(lastHit.sortValues) : null
    return { items, hasMore: result.hasMore, nextCursor }
  }

  async function search(
    q: string,
    type: SearchType,
    limit: number,
    cursor: string | undefined,
    viewerId?: bigint,
  ): Promise<SearchPage> {
    const parsed = parseSearchQuery(q)
    const searchAfter = cursor ? decodeSearchCursor(cursor) : undefined

    if (type === 'people') return searchPeople(parsed, limit, searchAfter, viewerId)
    return searchPosts(parsed, type, limit, searchAfter, viewerId)
  }

  return { search }
}
