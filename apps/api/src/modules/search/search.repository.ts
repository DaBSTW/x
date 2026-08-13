import type { Client } from '@opensearch-project/opensearch'
import { POSTS_SEARCH_INDEX, USERS_SEARCH_INDEX } from '@x/utils'
import type { OpenSearchQueryBody, SortValues } from './query-builder.js'

export type SearchHit = { id: string; sortValues: SortValues }
export type SearchResult = { hits: SearchHit[]; hasMore: boolean }

export type SearchRepository = ReturnType<typeof createSearchRepository>

/**
 * Thin OpenSearch access — query bodies come in fully built
 * (query-builder.ts), this only knows how to run them and shape the
 * response. Over-fetches by one (the same "ask for size+1, hasMore = got
 * more than size" convention every cursor-paginated repository in this
 * codebase already uses, e.g. posts.repository.ts) so `hasMore` doesn't
 * need a second round trip or a `track_total_hits` count.
 */
export function createSearchRepository(client: Client) {
  async function search(
    index: string,
    body: OpenSearchQueryBody,
    size: number,
  ): Promise<SearchResult> {
    const { body: result } = await client.search({
      index,
      body: { ...body, size: size + 1 },
    })
    const hits = (result.hits.hits as unknown as Array<{ _id: string; sort?: SortValues }>).map(
      (hit) => ({ id: hit._id, sortValues: hit.sort ?? [] }),
    )
    const hasMore = hits.length > size
    return { hits: hits.slice(0, size), hasMore }
  }

  /**
   * Typeahead's own two calls — no over-fetch-by-one (nothing paginates a
   * typeahead dropdown) and, for hashtags, the real payload is the
   * aggregation bucket, not `hits` (query-builder.ts's
   * buildHashtagTypeaheadQueryBody sets `size: 0` for exactly this reason).
   */
  async function typeaheadUsers(body: OpenSearchQueryBody): Promise<string[]> {
    const { body: result } = await client.search({ index: USERS_SEARCH_INDEX, body })
    return (result.hits.hits as unknown as Array<{ _id: string }>).map((hit) => hit._id)
  }

  async function typeaheadHashtags(body: OpenSearchQueryBody): Promise<string[]> {
    const { body: result } = await client.search({ index: POSTS_SEARCH_INDEX, body })
    const buckets = (
      result.aggregations as { hashtags?: { buckets?: Array<{ key: string }> } } | undefined
    )?.hashtags?.buckets
    return (buckets ?? []).map((bucket) => bucket.key)
  }

  return {
    searchPosts: (body: OpenSearchQueryBody, size: number) =>
      search(POSTS_SEARCH_INDEX, body, size),
    searchUsers: (body: OpenSearchQueryBody, size: number) =>
      search(USERS_SEARCH_INDEX, body, size),
    typeaheadUsers,
    typeaheadHashtags,
  }
}
