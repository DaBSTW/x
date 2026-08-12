import { describe, expect, it } from 'vitest'
import {
  MIN_AUTHOR_POST_RATIO,
  MIN_UNIQUE_AUTHORS,
  computeTrendScore,
  passesTrendFilters,
} from './trends.js'

describe('computeTrendScore', () => {
  it('matches the SPECS.md §10.4 formula for ordinary inputs', () => {
    // score = (count1h / max(baseline, 1)) · log(1 + uniqueAuthors)
    const score = computeTrendScore({ count1h: 200, baselineHourly: 50, uniqueAuthors: 80 })
    expect(score).toBeCloseTo((200 / 50) * Math.log(81), 10)
  })

  it('floors baselineHourly at 1 to avoid dividing by zero for a brand-new hashtag', () => {
    const withZeroBaseline = computeTrendScore({
      count1h: 60,
      baselineHourly: 0,
      uniqueAuthors: 60,
    })
    const withOneBaseline = computeTrendScore({
      count1h: 60,
      baselineHourly: 1,
      uniqueAuthors: 60,
    })
    expect(withZeroBaseline).toBe(withOneBaseline)
    expect(Number.isFinite(withZeroBaseline)).toBe(true)
  })

  it('is zero when there is no activity in the window, regardless of authors', () => {
    expect(computeTrendScore({ count1h: 0, baselineHourly: 10, uniqueAuthors: 100 })).toBe(0)
  })

  it('grows with unique authors even at a fixed count and baseline', () => {
    const fewAuthors = computeTrendScore({ count1h: 100, baselineHourly: 20, uniqueAuthors: 10 })
    const manyAuthors = computeTrendScore({ count1h: 100, baselineHourly: 20, uniqueAuthors: 90 })
    expect(manyAuthors).toBeGreaterThan(fewAuthors)
  })
})

describe('passesTrendFilters', () => {
  const noBlacklist = new Set<string>()

  it('passes a candidate that clears both the author floor and the ratio', () => {
    expect(
      passesTrendFilters({ hashtag: 'mundial', uniqueAuthors: 60, postCount1h: 100 }, noBlacklist),
    ).toBe(true)
  })

  it(`rejects fewer than ${MIN_UNIQUE_AUTHORS} unique authors even with a perfect ratio`, () => {
    expect(
      passesTrendFilters({ hashtag: 'nicho', uniqueAuthors: 10, postCount1h: 10 }, noBlacklist),
    ).toBe(false)
  })

  it(`rejects an authors/posts ratio below ${MIN_AUTHOR_POST_RATIO} — a few accounts flooding one tag`, () => {
    // 60 unique authors clears the floor, but 60/300 = 0.2 < 0.3.
    expect(
      passesTrendFilters({ hashtag: 'spam', uniqueAuthors: 60, postCount1h: 300 }, noBlacklist),
    ).toBe(false)
  })

  it('accepts a ratio exactly at the 0.3 boundary', () => {
    expect(
      passesTrendFilters({ hashtag: 'limite', uniqueAuthors: 60, postCount1h: 200 }, noBlacklist),
    ).toBe(true)
  })

  it('rejects a blacklisted hashtag even with otherwise-perfect stats', () => {
    expect(
      passesTrendFilters(
        { hashtag: 'baneado', uniqueAuthors: 1000, postCount1h: 1000 },
        new Set(['baneado']),
      ),
    ).toBe(false)
  })

  it('matches the blacklist case-insensitively', () => {
    expect(
      passesTrendFilters(
        { hashtag: 'Baneado', uniqueAuthors: 1000, postCount1h: 1000 },
        new Set(['baneado']),
      ),
    ).toBe(false)
  })

  it('rejects zero posts in the window without dividing by zero', () => {
    expect(
      passesTrendFilters({ hashtag: 'vacio', uniqueAuthors: 0, postCount1h: 0 }, noBlacklist),
    ).toBe(false)
  })
})
