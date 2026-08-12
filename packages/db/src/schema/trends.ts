import {
  bigint,
  doublePrecision,
  index,
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

// ROADMAP.md 2.4 / SPECS.md §10.4 — the ranked snapshot `GET /trends` reads.
// The source of truth for *why* a hashtag scored what it did is ClickHouse
// (raw hashtag_mentions events, apps/workers/src/trends/clickhouse-client.ts);
// this table is a derived, disposable read cache the 5-minute compute-trends
// job replaces wholesale on every run — never updated in place, always a
// full delete-and-reinsert per scope inside one transaction (so a reader
// never observes an empty gap between the two). Losing every row here costs
// nothing but staleness until the next run, same posture as `timeline:{uid}`
// in Redis being rebuildable from Postgres.
export const trendingTopics = pgTable(
  'trending_topics',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    // 'global', or an ISO 639-1 code (packages/utils' detectLanguage) for a
    // language-segmented snapshot — SPECS.md §10.4's region (WOEID)
    // segmentation isn't built (no geocoding provider available; see
    // ROADMAP.md 2.4's note), so scope is the only axis today.
    scope: varchar('scope', { length: 16 }).notNull(),
    // Matches post_entities.value's length (packages/db/src/schema/posts.ts)
    // — a trending hashtag is, definitionally, a value that already exists
    // there.
    hashtag: varchar('hashtag', { length: 300 }).notNull(),
    score: doublePrecision('score').notNull(),
    postCount1h: integer('post_count_1h').notNull(),
    uniqueAuthors1h: integer('unique_authors_1h').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // GET /trends's only query: current top N for a scope, highest score
    // first. No separate uniqueness constraint on (scope, hashtag) — the
    // compute job's own GROUP BY hashtag already guarantees that per run,
    // and enforcing it in the schema would only catch a bug the job's own
    // tests already catch first.
    index('idx_trending_topics_scope_score').on(table.scope, table.score.desc()),
  ],
)
export type TrendingTopic = typeof trendingTopics.$inferSelect
export type NewTrendingTopic = typeof trendingTopics.$inferInsert
