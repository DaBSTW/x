import { type ClickHouseClient, createClient } from '@clickhouse/client'

export type ClickHouseConfig = {
  url: string
  username: string
  password: string
  database: string
}

export function createClickHouseClient(config: ClickHouseConfig): ClickHouseClient {
  return createClient(config)
}

// Raw hashtag-mention events (ROADMAP.md 2.4) — one row per hashtag on a
// post, written by trend-ingest.repository.ts and read back, aggregated,
// by trends.repository.ts's compute-trends queries (SPECS.md §10.4).
export const HASHTAG_MENTIONS_TABLE = 'hashtag_mentions'

// No migration tool wires up ClickHouse in this repo — packages/db's
// drizzle-kit only speaks Postgres, and standing one up for a single table
// would be out of proportion to what this feature needs. An idempotent DDL
// statement, applied once on worker boot (same spirit as
// packages/db/src/migrate.ts, scaled down to match), is the proportionate
// choice; revisit with a real migration tool if the schema grows.
//
// TTL 30 days: comfortably past the 7-day baseline window SPECS.md §10.4's
// scoring needs, without keeping mention events forever — this table is
// disposable input to a job that only ever looks 7 days back, never a
// historical record anything else depends on.
export async function ensureHashtagMentionsTable(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${HASHTAG_MENTIONS_TABLE} (
        hashtag String,
        post_id UInt64,
        author_id UInt64,
        lang String,
        created_at DateTime64(3)
      )
      ENGINE = MergeTree
      PARTITION BY toYYYYMM(created_at)
      ORDER BY (hashtag, created_at)
      TTL toDateTime(created_at) + INTERVAL 30 DAY
    `,
  })
}
