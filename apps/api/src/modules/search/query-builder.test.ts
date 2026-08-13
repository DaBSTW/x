import { describe, expect, it } from 'vitest'
import {
  buildHashtagTypeaheadQueryBody,
  buildPostsQueryBody,
  buildUserTypeaheadQueryBody,
  buildUsersQueryBody,
  postsSort,
  usersSort,
} from './query-builder.js'
import { parseSearchQuery } from './query-operators.js'

describe('buildPostsQueryBody', () => {
  it('matches plain terms and phrases differently — match vs match_phrase', () => {
    const body = buildPostsQueryBody(parseSearchQuery('gato "perro grande"'), { type: 'latest' })
    const bool = body.query as { bool: { must: unknown[] } }
    expect(bool.bool.must).toContainEqual({ match: { text: 'gato' } })
    expect(bool.bool.must).toContainEqual({ match_phrase: { text: 'perro grande' } })
  })

  it('filters hashtags/mentions as exact keyword terms, not full-text matches', () => {
    const body = buildPostsQueryBody(parseSearchQuery('#mundial @ana'), { type: 'latest' })
    const bool = body.query as { bool: { filter: unknown[] } }
    expect(bool.bool.filter).toContainEqual({ term: { hashtags: 'mundial' } })
    expect(bool.bool.filter).toContainEqual({ term: { mentions: 'ana' } })
  })

  it('translates from:/to:/filter:/min_faves:/since:/until:/lang: into filter clauses', () => {
    const parsed = parseSearchQuery(
      'from:ana to:bob filter:links min_faves:10 since:2026-01-01 until:2026-06-01 lang:es',
    )
    const body = buildPostsQueryBody(parsed, { type: 'latest' })
    const bool = body.query as { bool: { filter: unknown[] } }
    expect(bool.bool.filter).toContainEqual({ term: { author_handle: 'ana' } })
    // to: reads as "mentions this user" — query-operators.ts's own documented interpretation.
    expect(bool.bool.filter).toContainEqual({ term: { mentions: 'bob' } })
    expect(bool.bool.filter).toContainEqual({ term: { has_links: true } })
    expect(bool.bool.filter).toContainEqual({ range: { engagement: { gte: 10 } } })
    expect(bool.bool.filter).toContainEqual({ range: { created_at: { gte: '2026-01-01' } } })
    expect(bool.bool.filter).toContainEqual({
      range: { created_at: { lte: '2026-06-01T23:59:59.999Z' } },
    })
    expect(bool.bool.filter).toContainEqual({ term: { lang: 'es' } })
  })

  it('excludes a negated term across text/hashtags/mentions via multi_match must_not', () => {
    const body = buildPostsQueryBody(parseSearchQuery('gato -perro'), { type: 'latest' })
    const bool = body.query as { bool: { must_not: unknown[] } }
    expect(bool.bool.must_not).toContainEqual({
      multi_match: { query: 'perro', fields: ['text', 'hashtags', 'mentions'] },
    })
  })

  it('falls back to match_all only when there is truly nothing to match on — no text, filter, hashtag, or mention', () => {
    const body = buildPostsQueryBody(parseSearchQuery('   '), { type: 'latest' })
    const bool = body.query as { bool: { must: unknown[] } }
    expect(bool.bool.must).toContainEqual({ match_all: {} })
  })

  it('does NOT fall back to match_all when a structured operator alone already scopes the query (e.g. from:ana)', () => {
    const body = buildPostsQueryBody(parseSearchQuery('from:ana'), { type: 'latest' })
    const bool = body.query as { bool: { must: unknown[]; filter: unknown[] } }
    expect(bool.bool.must).toEqual([])
    expect(bool.bool.filter).toContainEqual({ term: { author_handle: 'ana' } })
  })

  it('media mode forces has_media:true even without an explicit filter:media operator', () => {
    const body = buildPostsQueryBody(parseSearchQuery('gato'), { type: 'media' })
    const bool = body.query as { bool: { filter: unknown[] } }
    expect(bool.bool.filter).toContainEqual({ term: { has_media: true } })
  })

  it('wraps the query in function_score only for top mode, with BM25-additive score/boost mode', () => {
    const top = buildPostsQueryBody(parseSearchQuery('gato'), { type: 'top' })
    expect(top.query).toHaveProperty('function_score')
    const fnScore = (top.query as { function_score: Record<string, unknown> }).function_score
    expect(fnScore.score_mode).toBe('sum')
    expect(fnScore.boost_mode).toBe('sum')

    const latest = buildPostsQueryBody(parseSearchQuery('gato'), { type: 'latest' })
    expect(latest.query).not.toHaveProperty('function_score')
  })

  it('adds a social-affinity boost function only when followingAuthorIds is non-empty', () => {
    const withFollowing = buildPostsQueryBody(parseSearchQuery('gato'), {
      type: 'top',
      followingAuthorIds: ['1', '2'],
    })
    const fnsWith = (
      withFollowing.query as { function_score: { functions: Record<string, unknown>[] } }
    ).function_score.functions
    expect(fnsWith).toContainEqual({ filter: { terms: { author_id: ['1', '2'] } }, weight: 2 })

    const withoutFollowing = buildPostsQueryBody(parseSearchQuery('gato'), { type: 'top' })
    const fnsWithout = (
      withoutFollowing.query as { function_score: { functions: Record<string, unknown>[] } }
    ).function_score.functions
    expect(fnsWithout.some((fn) => 'filter' in fn)).toBe(false)
  })

  it('sorts top by _score then id, and latest/media by created_at then id, each with search_after omitted unless given', () => {
    expect(postsSort('top')).toEqual([{ _score: { order: 'desc' } }, { id: { order: 'desc' } }])
    expect(postsSort('latest')).toEqual([
      { created_at: { order: 'desc' } },
      { id: { order: 'desc' } },
    ])

    const withoutCursor = buildPostsQueryBody(parseSearchQuery('gato'), { type: 'latest' })
    expect(withoutCursor).not.toHaveProperty('search_after')

    const withCursor = buildPostsQueryBody(parseSearchQuery('gato'), {
      type: 'latest',
      searchAfter: ['2026-01-01T00:00:00.000Z', '42'],
    })
    expect(withCursor.search_after).toEqual(['2026-01-01T00:00:00.000Z', '42'])
  })
})

describe('buildUsersQueryBody', () => {
  it('matches free terms/phrases against both username and display_name', () => {
    const body = buildUsersQueryBody(parseSearchQuery('ana'))
    const bool = body.query as { bool: { should: unknown[]; minimum_should_match: number } }
    expect(bool.bool.should).toContainEqual({ match: { username: 'ana' } })
    expect(bool.bool.should).toContainEqual({ match: { display_name: 'ana' } })
    expect(bool.bool.minimum_should_match).toBe(1)
  })

  it('falls back to match_all for an operator-only or empty query', () => {
    const body = buildUsersQueryBody(parseSearchQuery(''))
    const bool = body.query as { bool: { must: unknown[] } }
    expect(bool.bool.must).toContainEqual({ match_all: {} })
  })

  it('excludes a negated term across username/display_name', () => {
    const body = buildUsersQueryBody(parseSearchQuery('-bot'))
    const bool = body.query as { bool: { must_not: unknown[] } }
    expect(bool.bool.must_not).toContainEqual({
      multi_match: { query: 'bot', fields: ['username', 'display_name'] },
    })
  })

  it('sorts by followers_count then id', () => {
    expect(usersSort()).toEqual([{ followers_count: { order: 'desc' } }, { id: { order: 'desc' } }])
  })
})

describe('buildUserTypeaheadQueryBody', () => {
  it('matches the raw prefix against username and display_name, sorted and sized', () => {
    const body = buildUserTypeaheadQueryBody('an', 10)
    const bool = body.query as { bool: { should: unknown[]; minimum_should_match: number } }
    expect(bool.bool.should).toContainEqual({ match: { username: 'an' } })
    expect(bool.bool.should).toContainEqual({ match: { display_name: 'an' } })
    expect(bool.bool.minimum_should_match).toBe(1)
    expect(body.sort).toEqual(usersSort())
    expect(body.size).toBe(10)
  })
})

describe('buildHashtagTypeaheadQueryBody', () => {
  it('prefix-matches hashtags and aggregates distinct matching values, with size:0 (no hits, only the aggregation matters)', () => {
    const body = buildHashtagTypeaheadQueryBody('mun', 5)
    expect(body.size).toBe(0)
    expect(body.query).toEqual({ prefix: { hashtags: 'mun' } })
    const aggs = body.aggs as {
      hashtags: { terms: { field: string; size: number; include: string } }
    }
    expect(aggs.hashtags.terms).toEqual({ field: 'hashtags', size: 5, include: 'mun.*' })
  })

  it('escapes a regex metacharacter in the prefix so the aggregation include stays a literal prefix match', () => {
    const body = buildHashtagTypeaheadQueryBody('c++', 5)
    const aggs = body.aggs as { hashtags: { terms: { include: string } } }
    expect(aggs.hashtags.terms.include).toBe('c\\+\\+.*')
  })
})
