// ROADMAP.md 2.4 / SPECS.md §10.4 — pure scoring and filtering, no I/O.
// apps/workers' compute-trends script (the only caller) gathers
// count1h/baselineHourly/uniqueAuthors/postCount1h per hashtag from
// ClickHouse, then asks these two functions what to do with the numbers.

/** SPECS.md §10.4: "mínimo 50 autores únicos". */
export const MIN_UNIQUE_AUTHORS = 50

// SPECS.md §10.4 phrases the antispam gate as "ratio autores/posts < 0.3"
// excludes — expressed here as the minimum *allowed* ratio so
// passesTrendFilters reads as a single AND of "big enough" and "not spammy
// enough to exclude", not two negated conditions.
export const MIN_AUTHOR_POST_RATIO = 0.3

/** No language/region filter applied — the default (and, until region
 * segmentation is built, only) scope a trend snapshot is computed for. */
export const GLOBAL_TREND_SCOPE = 'global'

export type TrendCandidateStats = {
  count1h: number
  baselineHourly: number
  uniqueAuthors: number
}

/**
 * `score = (count_1h / max(baseline_hourly, 1)) · log(1 + unique_authors)`
 * — SPECS.md §10.4, verbatim. `max(baselineHourly, 1)` is the spec's own
 * guard against dividing by zero for a hashtag with no 7-day history (brand
 * new): `count1h` alone then dominates the score, which is the right
 * outcome for a genuinely new trend rather than an infinite or NaN score.
 */
export function computeTrendScore(stats: TrendCandidateStats): number {
  return (stats.count1h / Math.max(stats.baselineHourly, 1)) * Math.log(1 + stats.uniqueAuthors)
}

export type TrendFilterInput = {
  hashtag: string
  uniqueAuthors: number
  postCount1h: number
}

/**
 * SPECS.md §10.4's antispam gate: at least {@link MIN_UNIQUE_AUTHORS}
 * distinct authors in the window, and an authors/posts ratio no lower than
 * {@link MIN_AUTHOR_POST_RATIO} — a handful of accounts posting the same
 * hashtag hundreds of times each fails this even with plenty of raw volume.
 * `blacklist` is matched case-insensitively: hashtags are already stored
 * lowercase (packages/utils' entity parser normalizes at parse time), but a
 * hand-maintained list is exactly the kind of input that risks a stray
 * uppercase letter.
 */
export function passesTrendFilters(
  candidate: TrendFilterInput,
  blacklist: ReadonlySet<string>,
): boolean {
  if (blacklist.has(candidate.hashtag.toLowerCase())) return false
  if (candidate.uniqueAuthors < MIN_UNIQUE_AUTHORS) return false
  if (candidate.postCount1h === 0) return false
  return candidate.uniqueAuthors / candidate.postCount1h >= MIN_AUTHOR_POST_RATIO
}
