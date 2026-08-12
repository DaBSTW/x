import type { ClickHouseClient } from '@clickhouse/client'
import type { TrendIngestJobData } from '@x/utils'
import { HASHTAG_MENTIONS_TABLE } from './clickhouse-client.js'

export type TrendIngestRepository = ReturnType<typeof createTrendIngestRepository>

export function createTrendIngestRepository(client: ClickHouseClient) {
  return {
    /**
     * One row per hashtag on the post (ROADMAP.md 2.4) — a post with 3
     * hashtags contributes 3 independent mention rows, since the scoring
     * job (SPECS.md §10.4) counts per-hashtag occurrences, not per-post.
     * `post_id`/`author_id` travel as the same strings the job carried them
     * as, never coerced to a JS number first — both can exceed
     * Number.MAX_SAFE_INTEGER (verified empirically: @clickhouse/client
     * round-trips a numeric string into a UInt64 column losslessly, but a
     * JS number literal above 2^53 already loses precision before it ever
     * reaches the client).
     */
    async insertMentions(job: TrendIngestJobData): Promise<void> {
      if (job.hashtags.length === 0) return
      await client.insert({
        table: HASHTAG_MENTIONS_TABLE,
        values: job.hashtags.map((hashtag) => ({
          hashtag,
          post_id: job.postId,
          author_id: job.authorId,
          // '' is this table's "unknown language" sentinel, not
          // Nullable(String) — one fewer null-handling branch in every
          // query that reads this column back (trends.repository.ts).
          lang: job.lang ?? '',
          created_at: job.createdAtMs,
        })),
        format: 'JSONEachRow',
      })
    },
  }
}
