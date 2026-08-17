import type { ClickHouseClient } from '@clickhouse/client'

// Raw Core Web Vitals reports (ROADMAP.md 3.4g / SPECS.md §14) — one row
// per metric per page view, written by rum-ingest.repository.ts. Shares
// the single ClickHouse client server.ts already owns for
// hashtag_mentions (ROADMAP.md 2.4) rather than creating a second
// connection — same instance, a second table on it.
export const WEB_VITALS_TABLE = 'web_vitals'

// Same reasoning as trends/clickhouse-client.ts's own ensureHashtagMentionsTable
// comment for why this is idempotent DDL on worker boot rather than a real
// migration tool: a single new table doesn't justify standing one up.
//
// TTL 30 days, matching hashtag_mentions — SPECS.md §14 doesn't name a
// specific retention window for RUM the way §10.4 does for trend scoring
// (a 7-day baseline), so there's no reason to diverge from the one
// precedent already established in this same ClickHouse instance rather
// than inventing a second convention.
export async function ensureWebVitalsTable(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${WEB_VITALS_TABLE} (
        metric String,
        value Float64,
        rating String,
        path String,
        navigation_type String,
        created_at DateTime64(3)
      )
      ENGINE = MergeTree
      PARTITION BY toYYYYMM(created_at)
      ORDER BY (metric, created_at)
      TTL toDateTime(created_at) + INTERVAL 30 DAY
    `,
  })
}
