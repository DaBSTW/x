import { parseEntities } from './entities.js'

export const MAX_POST_GRAPHEMES = 280
// A URL always counts as exactly this many characters, whatever its real
// length — SPECS.md §1.2 / ROADMAP.md 1.1. Matches the platform this is
// modeled after, and keeps a long tracking URL from silently eating the
// whole post budget.
const URL_WEIGHT = 23

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Counts a post the way the product counts it: grapheme clusters (via
 * `Intl.Segmenter`, so a ZWJ-joined emoji or a combining accent counts once,
 * not per code point) — except URLs, which always count as {@link URL_WEIGHT}.
 *
 * The same function runs on client and server (CODESTYLE.md §3): the
 * composer's live counter and the server's validation must never disagree.
 */
export function countCharacters(text: string): number {
  const urls = parseEntities(text).filter((entity) => entity.kind === 'url')
  if (urls.length === 0) {
    return countGraphemes(text)
  }

  const codePoints = Array.from(text)
  let total = 0
  let cursor = 0

  for (const url of urls) {
    const before = codePoints.slice(cursor, url.start).join('')
    total += countGraphemes(before) + URL_WEIGHT
    cursor = url.end
  }
  total += countGraphemes(codePoints.slice(cursor).join(''))

  return total
}

function countGraphemes(text: string): number {
  if (text.length === 0) return 0
  let count = 0
  for (const _segment of segmenter.segment(text)) count++
  return count
}
