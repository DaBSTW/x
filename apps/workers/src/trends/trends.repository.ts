import type { ClickHouseClient } from '@clickhouse/client'
import type { Database } from '@x/db'
import { trendingTopics } from '@x/db'
import { generateId } from '@x/utils'
import { inArray } from 'drizzle-orm'
import { HASHTAG_MENTIONS_TABLE } from './clickhouse-client.js'

// The 7-day baseline (SPECS.md §10.4) excludes the 1h window it's being
// compared against — 167 hours (168 - 1), not 168 — so a viral spike in the
// current hour never dilutes its own baseline average.
export const BASELINE_WINDOW_HOURS = 167

export type HashtagStatsRow = {
  hashtag: string
  count1h: number
  uniqueAuthors1h: number
  /** Raw mention count over the 167-hour window preceding the last hour — divide by {@link BASELINE_WINDOW_HOURS} for the hourly average SPECS.md §10.4's formula wants. */
  baselineWindowCount: number
}

type RawStatsRow = {
  hashtag: string
  count1h: string
  uniqueAuthors1h: string
  baselineWindowCount: string
}

export type TrendSnapshotRow = {
  scope: string
  hashtag: string
  score: number
  postCount1h: number
  uniqueAuthors1h: number
}

export type TrendsRepository = ReturnType<typeof createTrendsRepository>

export function createTrendsRepository(clickhouse: ClickHouseClient, db: Database) {
  return {
    /**
     * Every hashtag with at least one mention in the last hour, plus the
     * unique-author and baseline figures SPECS.md §10.4's scoring formula
     * and antispam filter both need. `lang` narrows to mentions from posts
     * detectLanguage tagged with that code; omitted computes across every
     * language (the 'global' scope). ClickHouse returns UInt64/count()
     * aggregates as strings over HTTP (verified directly against a real
     * server) — parsed to Number here since none of them can realistically
     * exceed Number.MAX_SAFE_INTEGER the way a Snowflake id can.
     */
    async fetchHashtagStats(lang?: string): Promise<HashtagStatsRow[]> {
      const rs = await clickhouse.query({
        query: `
          SELECT
            hashtag,
            countIf(created_at >= now() - INTERVAL 1 HOUR) AS count1h,
            uniqExactIf(author_id, created_at >= now() - INTERVAL 1 HOUR) AS uniqueAuthors1h,
            countIf(created_at >= now() - INTERVAL 7 DAY AND created_at < now() - INTERVAL 1 HOUR) AS baselineWindowCount
          FROM ${HASHTAG_MENTIONS_TABLE}
          WHERE created_at >= now() - INTERVAL 7 DAY
          ${lang !== undefined ? 'AND lang = {lang:String}' : ''}
          GROUP BY hashtag
          HAVING count1h > 0
        `,
        ...(lang !== undefined && { query_params: { lang } }),
        format: 'JSONEachRow',
      })
      const rows = await rs.json<RawStatsRow>()
      return rows.map((row) => ({
        hashtag: row.hashtag,
        count1h: Number(row.count1h),
        uniqueAuthors1h: Number(row.uniqueAuthors1h),
        baselineWindowCount: Number(row.baselineWindowCount),
      }))
    },

    /** Distinct non-empty languages with any mention in the last hour — the per-language scopes this run has fresh data for, discovered rather than hardcoded to whatever detectLanguage happens to support. */
    async fetchActiveLanguages(): Promise<string[]> {
      const rs = await clickhouse.query({
        query: `
          SELECT DISTINCT lang
          FROM ${HASHTAG_MENTIONS_TABLE}
          WHERE created_at >= now() - INTERVAL 1 HOUR AND lang != ''
        `,
        format: 'JSONEachRow',
      })
      const rows = await rs.json<{ lang: string }>()
      return rows.map((row) => row.lang)
    },

    /** Every scope a previous run left a snapshot for — unioned into the current run's delete set (computeTrends.ts) so a scope that cools off (no qualifying hashtag this run) gets cleared instead of serving stale trends forever. */
    async fetchExistingScopes(): Promise<string[]> {
      const rows = await db.selectDistinct({ scope: trendingTopics.scope }).from(trendingTopics)
      return rows.map((row) => row.scope)
    },

    /**
     * Replaces every row for `scopes` in one transaction — under this
     * project's default READ COMMITTED isolation, a concurrent GET /trends
     * read either sees the previous run's complete snapshot or this run's,
     * never a partially-deleted state in between (Postgres MVCC: an
     * uncommitted transaction's writes are invisible to other transactions
     * until commit). `scopes` should already be every scope this run
     * touches, including ones with zero rows to insert.
     */
    async replaceSnapshot(scopes: string[], rows: TrendSnapshotRow[], computedAt: Date) {
      await db.transaction(async (tx) => {
        if (scopes.length > 0) {
          await tx.delete(trendingTopics).where(inArray(trendingTopics.scope, scopes))
        }
        if (rows.length > 0) {
          await tx.insert(trendingTopics).values(
            rows.map((row) => ({
              id: generateId(),
              scope: row.scope,
              hashtag: row.hashtag,
              score: row.score,
              postCount1h: row.postCount1h,
              uniqueAuthors1h: row.uniqueAuthors1h,
              computedAt,
            })),
          )
        }
      })
    },
  }
}
