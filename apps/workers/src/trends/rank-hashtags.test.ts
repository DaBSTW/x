import { GLOBAL_TREND_SCOPE, MAX_TRENDS_PER_SCOPE } from '@x/utils'
import { describe, expect, it } from 'vitest'
import { rankHashtags } from './rank-hashtags.js'
import type { HashtagStatsRow } from './trends.repository.js'

function makeStats(overrides: Partial<HashtagStatsRow> & { hashtag: string }): HashtagStatsRow {
  return {
    count1h: 100,
    uniqueAuthors1h: 60,
    baselineWindowCount: 167, // averages to exactly 1/hour
    ...overrides,
  }
}

describe('rankHashtags', () => {
  const noBlacklist = new Set<string>()

  it('drops candidates that fail the antispam filter, keeps the ones that pass', () => {
    const spam = makeStats({ hashtag: 'spam', count1h: 500, uniqueAuthors1h: 5 }) // ratio 0.01
    const real = makeStats({ hashtag: 'mundial', count1h: 200, uniqueAuthors1h: 80 })

    const ranked = rankHashtags(GLOBAL_TREND_SCOPE, [spam, real], noBlacklist)

    expect(ranked.map((r) => r.hashtag)).toEqual(['mundial'])
  })

  it('sorts by score descending', () => {
    const low = makeStats({ hashtag: 'tibio', count1h: 60, uniqueAuthors1h: 55 })
    const high = makeStats({ hashtag: 'viral', count1h: 900, uniqueAuthors1h: 300 })

    const ranked = rankHashtags(GLOBAL_TREND_SCOPE, [low, high], noBlacklist)

    expect(ranked.map((r) => r.hashtag)).toEqual(['viral', 'tibio'])
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? Number.POSITIVE_INFINITY)
  })

  it('stamps every row with the scope it was computed for', () => {
    const ranked = rankHashtags('es', [makeStats({ hashtag: 'mundial' })], noBlacklist)
    expect(ranked[0]?.scope).toBe('es')
  })

  it(`caps the result at MAX_TRENDS_PER_SCOPE (${MAX_TRENDS_PER_SCOPE})`, () => {
    const stats = Array.from({ length: MAX_TRENDS_PER_SCOPE + 20 }, (_, i) =>
      makeStats({ hashtag: `tag${i}`, count1h: 100 + i }),
    )

    const ranked = rankHashtags(GLOBAL_TREND_SCOPE, stats, noBlacklist)

    expect(ranked).toHaveLength(MAX_TRENDS_PER_SCOPE)
    // Highest count1h (and therefore highest score, all else equal) survives the cut.
    expect(ranked[0]?.hashtag).toBe(`tag${stats.length - 1}`)
  })

  it('excludes a blacklisted hashtag regardless of how well it would otherwise score', () => {
    const ranked = rankHashtags(
      GLOBAL_TREND_SCOPE,
      [makeStats({ hashtag: 'baneado', count1h: 10_000, uniqueAuthors1h: 5000 })],
      new Set(['baneado']),
    )
    expect(ranked).toEqual([])
  })

  it('divides the baseline window count by 167 hours, not 168, before scoring', () => {
    // count1h=100, baseline window totals 1670 over 167h → baselineHourly=10
    // → score = (100/10)·log(1+uniqueAuthors), not (100/(1670/168))·...
    const stats = makeStats({
      hashtag: 'mundial',
      count1h: 100,
      uniqueAuthors1h: 60,
      baselineWindowCount: 1670,
    })
    const [ranked] = rankHashtags(GLOBAL_TREND_SCOPE, [stats], noBlacklist)
    expect(ranked?.score).toBeCloseTo((100 / 10) * Math.log(61), 10)
  })
})
