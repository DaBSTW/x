import { MAX_TRENDS_PER_SCOPE, computeTrendScore, passesTrendFilters } from '@x/utils'
import {
  BASELINE_WINDOW_HOURS,
  type HashtagStatsRow,
  type TrendSnapshotRow,
} from './trends.repository.js'

/**
 * Pure scoring pipeline for one scope's candidate hashtags (SPECS.md
 * §10.4) — no ClickHouse, no Postgres, so a wrong score or a filter that
 * lets spam through is a fast unit test, not a 2-minute Testcontainers
 * round trip. compute-trends.ts (the script) is the only caller, once per
 * scope it's computing.
 */
export function rankHashtags(
  scope: string,
  stats: HashtagStatsRow[],
  blacklist: ReadonlySet<string>,
): TrendSnapshotRow[] {
  return stats
    .filter((row) =>
      passesTrendFilters(
        { hashtag: row.hashtag, uniqueAuthors: row.uniqueAuthors1h, postCount1h: row.count1h },
        blacklist,
      ),
    )
    .map((row) => ({
      scope,
      hashtag: row.hashtag,
      score: computeTrendScore({
        count1h: row.count1h,
        baselineHourly: row.baselineWindowCount / BASELINE_WINDOW_HOURS,
        uniqueAuthors: row.uniqueAuthors1h,
      }),
      postCount1h: row.count1h,
      uniqueAuthors1h: row.uniqueAuthors1h,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TRENDS_PER_SCOPE)
}
