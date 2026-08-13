// SPECS.md §10.3: "Operadores soportados: from:usuario, to:usuario, #hashtag,
// @mención, "frase exacta", -excluir, filter:media, filter:links,
// min_faves:N, since:YYYY-MM-DD, until:YYYY-MM-DD, lang:es." Pure — no
// OpenSearch/query-body shape here, that's query-builder.ts's job — so this
// stays trivially unit-testable and reusable if a second caller (typeahead?
// a future saved-search feature) ever needs the parsed structure alone.

export type SearchFilter = 'media' | 'links'

export type ParsedSearchQuery = {
  /** Free-text words, OR'd together into the main relevance match (any word may match). */
  terms: string[]
  /** '"frase exacta"' — word-order-sensitive, unlike `terms` above, so query-builder.ts has to treat the two differently (match vs match_phrase). */
  phrases: string[]
  /** Hashtags to require, without '#', lowercased (matches how they're indexed — document-builders.ts). */
  hashtags: string[]
  /** Mentions to require, without '@', lowercased. */
  mentions: string[]
  /**
   * Terms/hashtags/mentions/phrases to exclude — '-excluir'. Deliberately
   * one flat bucket rather than separate excluded-hashtag/excluded-mention/
   * excluded-phrase lists: SPECS.md presents negation as "exclude this
   * token", not as a per-operator concept, and query-builder.ts checks
   * text/hashtags/mentions for each excluded value regardless of which
   * shape it looked like when typed.
   */
  excludedTerms: string[]
  /** 'from:usuario' — lowercased username, matches author_handle's own lowercased indexing. */
  from: string | null
  /** 'to:usuario' — read as "mentions this user" (mentions.ts), the same simple interpretation classic Twitter search itself used; SPECS.md names the operator without defining its exact matching semantics beyond that. */
  to: string | null
  filter: SearchFilter | null
  minFaves: number | null
  since: string | null
  until: string | null
  lang: string | null
}

const OPERATOR_PATTERNS = {
  from: /^from:(.+)$/i,
  to: /^to:(.+)$/i,
  filter: /^filter:(media|links)$/i,
  minFaves: /^min_faves:(\d+)$/i,
  since: /^since:(\d{4}-\d{2}-\d{2})$/i,
  until: /^until:(\d{4}-\d{2}-\d{2})$/i,
  lang: /^lang:([a-z]{2,8})$/i,
} as const

// Either a (possibly negated) quoted phrase, kept whole including its
// internal spaces, or a single non-whitespace run — the same simple
// tokenization every search engine's query-string mini-language starts
// from. The optional leading `-` has to be part of THIS pattern, not
// handled after the fact: without it, `-"frase mala"` would never match the
// quoted-phrase alternative at all (it doesn't start with `"`), so it'd
// fall through to \S+ and swallow only `-"frase` — right up to the space
// buried *inside* the phrase — as one broken token.
const TOKEN_PATTERN = /-?"[^"]*"|\S+/g

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const result: ParsedSearchQuery = {
    terms: [],
    phrases: [],
    hashtags: [],
    mentions: [],
    excludedTerms: [],
    from: null,
    to: null,
    filter: null,
    minFaves: null,
    since: null,
    until: null,
    lang: null,
  }

  const tokens = raw.match(TOKEN_PATTERN) ?? []
  for (const rawToken of tokens) {
    const negated = rawToken.startsWith('-') && rawToken.length > 1
    classifyToken(negated ? rawToken.slice(1) : rawToken, negated, result)
  }
  return result
}

function classifyToken(token: string, negated: boolean, result: ParsedSearchQuery): void {
  if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
    const phrase = token.slice(1, -1).trim()
    if (phrase.length === 0) return
    ;(negated ? result.excludedTerms : result.phrases).push(phrase)
    return
  }

  // Structured operators never apply negated — SPECS.md only defines
  // '-excluir' against a plain term/hashtag/mention/phrase, not against
  // e.g. 'from:'. A negated 'from:ana' falls through to being treated as
  // the literal excluded term "from:ana" below, a defensible reading of
  // something SPECS doesn't define either way.
  if (!negated && classifyOperator(token, result)) return

  if (token.startsWith('#') && token.length > 1) {
    const hashtag = token.slice(1).toLowerCase()
    ;(negated ? result.excludedTerms : result.hashtags).push(hashtag)
    return
  }
  if (token.startsWith('@') && token.length > 1) {
    const mention = token.slice(1).toLowerCase()
    ;(negated ? result.excludedTerms : result.mentions).push(mention)
    return
  }
  if (token.length === 0) return
  ;(negated ? result.excludedTerms : result.terms).push(token)
}

/** @returns true if `token` matched a structured operator (result was mutated), false otherwise. */
function classifyOperator(token: string, result: ParsedSearchQuery): boolean {
  const fromMatch = token.match(OPERATOR_PATTERNS.from)
  if (fromMatch?.[1]) {
    result.from = fromMatch[1].toLowerCase()
    return true
  }
  const toMatch = token.match(OPERATOR_PATTERNS.to)
  if (toMatch?.[1]) {
    result.to = toMatch[1].toLowerCase()
    return true
  }
  const filterMatch = token.match(OPERATOR_PATTERNS.filter)
  if (filterMatch?.[1]) {
    result.filter = filterMatch[1].toLowerCase() as SearchFilter
    return true
  }
  const minFavesMatch = token.match(OPERATOR_PATTERNS.minFaves)
  if (minFavesMatch?.[1]) {
    result.minFaves = Number(minFavesMatch[1])
    return true
  }
  const sinceMatch = token.match(OPERATOR_PATTERNS.since)
  if (sinceMatch?.[1]) {
    result.since = sinceMatch[1]
    return true
  }
  const untilMatch = token.match(OPERATOR_PATTERNS.until)
  if (untilMatch?.[1]) {
    result.until = untilMatch[1]
    return true
  }
  const langMatch = token.match(OPERATOR_PATTERNS.lang)
  if (langMatch?.[1]) {
    result.lang = langMatch[1].toLowerCase()
    return true
  }
  return false
}
