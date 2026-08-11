// Menciones, hashtags, URLs y cashtags, extraídos por code point — nunca por
// unidades UTF-16 ni bytes, para que un emoji compuesto (ZWJ) o texto CJK no
// desplace los offsets. CODESTYLE.md §3.

export type EntityKind = 'mention' | 'hashtag' | 'url' | 'cashtag'

export type ParsedEntity = {
  kind: EntityKind
  value: string
  // Offsets in code points (not UTF-16 code units), inclusive start, exclusive end.
  start: number
  end: number
}

// Usernames: 1-15 chars, letters/digits/underscore — matches
// packages/db's `username_format` check constraint.
//
// Trailing boundary is a negative lookahead, not `\b`: JS's `\b` is defined
// against ASCII `\w` only, so it silently fails to end a match after a
// non-ASCII letter (e.g. CJK) — verified against `#中文` matching nothing.
const MENTION_PATTERN = /(^|[^\p{L}\p{N}_])@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/gu
const HASHTAG_PATTERN = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{1,100})(?![\p{L}\p{N}_])/gu
const CASHTAG_PATTERN = /(^|[^\p{L}\p{N}_$])\$([A-Za-z]{1,6})(?![A-Za-z])/gu
// Deliberately conservative: http(s) only, no bare "example.com" — matching
// the client's URL affordance avoids surprising a user about what counts
// toward the 23-character URL allowance in countCharacters().
const URL_PATTERN = /https?:\/\/[^\s<>[\]{}|\\^`"]+/gu

/**
 * Extracts mentions, hashtags, URLs and cashtags from `text`, with offsets
 * in Unicode code points. Entities never overlap: a URL match suppresses
 * mention/hashtag/cashtag matches inside its span (e.g. a `#` in a URL's
 * query string isn't a hashtag).
 */
export function parseEntities(text: string): ParsedEntity[] {
  const entities: ParsedEntity[] = []

  collectMatches(text, URL_PATTERN, 'url', (match) => match[0], entities, [])
  const urlRanges = entities.map((entity) => [entity.start, entity.end] as const)

  collectMatches(text, MENTION_PATTERN, 'mention', (match) => match[2] ?? '', entities, urlRanges)
  collectMatches(
    text,
    HASHTAG_PATTERN,
    'hashtag',
    (match) => (match[2] ?? '').toLowerCase(),
    entities,
    urlRanges,
  )
  collectMatches(
    text,
    CASHTAG_PATTERN,
    'cashtag',
    (match) => (match[2] ?? '').toUpperCase(),
    entities,
    urlRanges,
  )

  entities.sort((a, b) => a.start - b.start)
  return entities
}

function collectMatches(
  text: string,
  pattern: RegExp,
  kind: EntityKind,
  getValue: (match: RegExpExecArray) => string,
  into: ParsedEntity[],
  excludeRanges: ReadonlyArray<readonly [number, number]>,
): void {
  pattern.lastIndex = 0
  let match: RegExpExecArray | null = pattern.exec(text)
  while (match !== null) {
    const prefixLength = match[1]?.length ?? 0
    const matchStartUtf16 = match.index + prefixLength
    const matchEndUtf16 = match.index + match[0].length

    const start = utf16IndexToCodePointIndex(text, matchStartUtf16)
    const end = utf16IndexToCodePointIndex(text, matchEndUtf16)

    const overlapsExcluded = excludeRanges.some(
      ([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart,
    )
    if (!overlapsExcluded) {
      into.push({ kind, value: getValue(match), start, end })
    }

    match = pattern.exec(text)
  }
}

// Converts a UTF-16 code unit offset into the corresponding code point
// index by scanning `text` up to that point — small strings (post length is
// capped at 280 graphemes), so this is cheap relative to correctness.
function utf16IndexToCodePointIndex(text: string, utf16Index: number): number {
  let codePointIndex = 0
  let utf16Cursor = 0
  for (const char of text) {
    if (utf16Cursor >= utf16Index) break
    utf16Cursor += char.length
    codePointIndex++
  }
  return codePointIndex
}
