import type { ParsedSearchQuery } from './query-operators.js'

export type OpenSearchQueryBody = Record<string, unknown>
/** Whatever OpenSearch's own `sort` values came back as on the last hit of a page — opaque to everything except cursor.ts. */
export type SortValues = (string | number)[]

const POSTS_SORT = {
  // _score first (function_score's own combined value), id as the
  // deterministic tiebreaker every search_after sort needs — two posts can
  // share a score, but never an id.
  top: [{ _score: { order: 'desc' } }, { id: { order: 'desc' } }],
  latest: [{ created_at: { order: 'desc' } }, { id: { order: 'desc' } }],
  media: [{ created_at: { order: 'desc' } }, { id: { order: 'desc' } }],
} as const

export function postsSort(type: 'top' | 'latest' | 'media'): Record<string, unknown>[] {
  return [...POSTS_SORT[type]]
}

export type PostsQueryOptions = {
  type: 'top' | 'latest' | 'media'
  searchAfter?: SortValues
  /** Capped list of author ids the viewer follows — SPECS.md §10.3's "afinidad social" function_score signal. Empty/omitted when anonymous or the viewer follows nobody; the signal just contributes nothing. */
  followingAuthorIds?: string[]
}

/**
 * Builds the `posts` index query for `top`/`latest`/`media` — everything
 * except `size`, which search.repository.ts owns (it over-fetches by one
 * for pagination's `hasMore`, a concern this module has no reason to know
 * about). The relevance half (must/filter/must_not from the parsed
 * operators) is identical across all three modes — SPECS.md §10.3 only
 * calls out `top`'s ranking as special, `latest`/`media` are the same
 * match, sorted by recency instead of score. `media` additionally filters
 * `has_media: true`, on top of whatever the query itself narrowed down — a
 * media search is still a search, not just a media browser.
 */
export function buildPostsQueryBody(
  parsed: ParsedSearchQuery,
  options: PostsQueryOptions,
): OpenSearchQueryBody {
  const bool = buildPostsBoolQuery(parsed, options.type === 'media')
  const query =
    options.type === 'top'
      ? { function_score: buildFunctionScore(bool, options.followingAuthorIds ?? []) }
      : bool

  const body: OpenSearchQueryBody = { query, sort: postsSort(options.type) }
  if (options.searchAfter) body.search_after = options.searchAfter
  return body
}

function buildPostsBoolQuery(
  parsed: ParsedSearchQuery,
  forceMedia: boolean,
): Record<string, unknown> {
  const must: Record<string, unknown>[] = []
  const filter: Record<string, unknown>[] = []
  const mustNot: Record<string, unknown>[] = []

  for (const term of parsed.terms) {
    must.push({ match: { text: term } })
  }
  for (const phrase of parsed.phrases) {
    must.push({ match_phrase: { text: phrase } })
  }
  for (const hashtag of parsed.hashtags) {
    filter.push({ term: { hashtags: hashtag } })
  }
  for (const mention of parsed.mentions) {
    filter.push({ term: { mentions: mention } })
  }
  if (parsed.from) filter.push({ term: { author_handle: parsed.from } })
  // 'to:usuario' — reads as "mentions this user" (query-operators.ts's own
  // docstring on why), so it folds into the same mentions filter a bare
  // '@usuario' token would have produced.
  if (parsed.to) filter.push({ term: { mentions: parsed.to } })
  if (parsed.filter === 'media' || forceMedia) filter.push({ term: { has_media: true } })
  if (parsed.filter === 'links') filter.push({ term: { has_links: true } })
  if (parsed.minFaves !== null) filter.push({ range: { engagement: { gte: parsed.minFaves } } })
  if (parsed.since) filter.push({ range: { created_at: { gte: parsed.since } } })
  if (parsed.until) filter.push({ range: { created_at: { lte: `${parsed.until}T23:59:59.999Z` } } })
  if (parsed.lang) filter.push({ term: { lang: parsed.lang } })

  for (const excluded of parsed.excludedTerms) {
    mustNot.push({
      multi_match: { query: excluded, fields: ['text', 'hashtags', 'mentions'] },
    })
  }

  // No text/phrase/hashtag/mention at all (e.g. the whole query was just
  // `from:ana`) still needs *something* in `must`, or an empty bool query
  // matches nothing instead of "everything the filters allow".
  if (
    must.length === 0 &&
    filter.length === 0 &&
    parsed.hashtags.length === 0 &&
    parsed.mentions.length === 0
  ) {
    must.push({ match_all: {} })
  }

  return { bool: { must, filter, must_not: mustNot } }
}

// SPECS.md §10.3 names the four ranking inputs without pinning weights —
// same "names it, doesn't define the internals" gap the multilang analyzer
// and engagement formula (apps/workers/src/search/document-builders.ts)
// already had to fill in. score_mode/boost_mode: 'sum' so BM25 stays the
// baseline and every signal below is a genuine *addition* on top of it,
// never a multiplier that could zero out an otherwise-relevant match.
function buildFunctionScore(
  query: Record<string, unknown>,
  followingAuthorIds: string[],
): Record<string, unknown> {
  const functions: Record<string, unknown>[] = [
    // log1p dampens a single viral outlier from completely burying every
    // other relevant result under it.
    { field_value_factor: { field: 'engagement', modifier: 'log1p', factor: 1, missing: 0 } },
    { gauss: { created_at: { origin: 'now', scale: '7d', decay: 0.5 } } },
  ]
  if (followingAuthorIds.length > 0) {
    functions.push({ filter: { terms: { author_id: followingAuthorIds } }, weight: 2 })
  }
  return { query, functions, score_mode: 'sum', boost_mode: 'sum' }
}

/**
 * `people` mode. Text relevance across username/display_name (both already
 * edge_ngram-indexed for typeahead, which doubles as fine full relevance
 * matching here) rather than the posts-only operators — `from:`/`filter:`/
 * `since:`/etc. don't mean anything for a user document, so only
 * terms/phrases/excludedTerms are read; the rest of `parsed` is ignored on
 * purpose, not a gap.
 */
export function buildUsersQueryBody(
  parsed: ParsedSearchQuery,
  searchAfter?: SortValues,
): OpenSearchQueryBody {
  const should: Record<string, unknown>[] = []
  const mustNot: Record<string, unknown>[] = []

  for (const term of [...parsed.terms, ...parsed.phrases]) {
    should.push({ match: { username: term } }, { match: { display_name: term } })
  }
  for (const excluded of parsed.excludedTerms) {
    mustNot.push({ multi_match: { query: excluded, fields: ['username', 'display_name'] } })
  }

  const query =
    should.length > 0
      ? { bool: { should, minimum_should_match: 1, must_not: mustNot } }
      : { bool: { must: [{ match_all: {} }], must_not: mustNot } }

  const body: OpenSearchQueryBody = { query, sort: usersSort() }
  if (searchAfter) body.search_after = searchAfter
  return body
}

export function usersSort(): Record<string, unknown>[] {
  // followers_count as the people-mode ranking signal (SPECS.md §10.1's own
  // words: "más followers_count como señal de ranking") — id tiebreaker,
  // same reasoning as postsSort.
  return [{ followers_count: { order: 'desc' } }, { id: { order: 'desc' } }]
}
