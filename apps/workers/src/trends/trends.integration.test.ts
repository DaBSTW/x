import { fileURLToPath } from 'node:url'
import type { ClickHouseClient } from '@clickhouse/client'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { type Database, createDatabase, migrationsFolderUrl, trendingTopics } from '@x/db'
import { GLOBAL_TREND_SCOPE, MIN_UNIQUE_AUTHORS } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  HASHTAG_MENTIONS_TABLE,
  createClickHouseClient,
  ensureHashtagMentionsTable,
} from './clickhouse-client.js'
import { rankHashtags } from './rank-hashtags.js'
import { createTrendsRepository } from './trends.repository.js'

const CLICKHOUSE_HTTP_PORT = 8123
const CLICKHOUSE_USER = 'x'
const CLICKHOUSE_PASSWORD = 'x'
const CLICKHOUSE_DATABASE = 'x_analytics'
const CLICKHOUSE_IMAGE = 'clickhouse/clickhouse-server:24.8-alpine'

// Same reasoning as trend-ingest.integration.test.ts's identical helper:
// @testcontainers/clickhouse's ClickHouseContainer hardcodes ulimits this
// sandbox's runtime rejects.
function createClickHouseContainer(image: string): GenericContainer {
  return new GenericContainer(image)
    .withEnvironment({
      CLICKHOUSE_USER,
      CLICKHOUSE_PASSWORD,
      CLICKHOUSE_DB: CLICKHOUSE_DATABASE,
    })
    .withExposedPorts(CLICKHOUSE_HTTP_PORT)
    .withWaitStrategy(
      Wait.forHttp('/ping', CLICKHOUSE_HTTP_PORT).forResponsePredicate(
        (response) => response === 'Ok.\n',
      ),
    )
}

type RawMention = {
  hashtag: string
  post_id: string
  author_id: string
  lang: string
  created_at: number
}

async function insertRawMentions(client: ClickHouseClient, rows: RawMention[]): Promise<void> {
  await client.insert({ table: HASHTAG_MENTIONS_TABLE, values: rows, format: 'JSONEachRow' })
}

/** `count` mentions of `hashtag` spread over `authorCount` distinct authors (cycling — some authors post more than once whenever count > authorCount, which is exactly how a real spam ratio gets low), all timestamped `msAgo` milliseconds before now. `postIdOffset` keeps post_id unique across multiple calls in the same test. */
function makeMentions(
  hashtag: string,
  count: number,
  authorCount: number,
  msAgo: number,
  lang: string,
  postIdOffset: number,
): RawMention[] {
  const createdAt = Date.now() - msAgo
  return Array.from({ length: count }, (_, i) => ({
    hashtag,
    post_id: String(postIdOffset + i),
    author_id: String((i % authorCount) + 1),
    lang,
    created_at: createdAt,
  }))
}

const ONE_HOUR_MS = 60 * 60 * 1000
const RECENT = 55 * 60 * 1000 // 55 min ago — safely inside the "last hour" window
const BASELINE = 3 * 24 * ONE_HOUR_MS // 3 days ago — inside the 7-day window, outside the last hour

describe('trend scoring (roadmap 2.4 / SPECS.md §10.4)', () => {
  let clickhouseContainer: StartedTestContainer
  let postgresContainer: StartedPostgreSqlContainer
  let clickhouse: ClickHouseClient
  let db: Database

  beforeAll(async () => {
    ;[clickhouseContainer, postgresContainer] = await Promise.all([
      createClickHouseContainer(CLICKHOUSE_IMAGE).start(),
      new PostgreSqlContainer('postgres:17-alpine').start(),
    ])
    clickhouse = createClickHouseClient({
      url: `http://${clickhouseContainer.getHost()}:${clickhouseContainer.getMappedPort(CLICKHOUSE_HTTP_PORT)}`,
      username: CLICKHOUSE_USER,
      password: CLICKHOUSE_PASSWORD,
      database: CLICKHOUSE_DATABASE,
    })
    await ensureHashtagMentionsTable(clickhouse)
    db = createDatabase(postgresContainer.getConnectionUri())
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })
  }, 120_000)

  afterEach(async () => {
    await clickhouse.command({ query: `TRUNCATE TABLE ${HASHTAG_MENTIONS_TABLE}` })
    await db.delete(trendingTopics)
  })

  afterAll(async () => {
    await clickhouse.close()
    await Promise.all([clickhouseContainer.stop(), postgresContainer.stop()])
  })

  it('ranks a real trend above a spam-ratio hashtag and a too-small niche one, end to end', async () => {
    // Real: 200 mentions, 80 distinct authors — ratio 0.4, well past both
    // MIN_UNIQUE_AUTHORS and the 0.3 ratio floor.
    await insertRawMentions(clickhouse, makeMentions('mundial', 200, 80, RECENT, 'es', 1000))
    // Spam: more raw volume than 'mundial', but only 5 authors — ratio
    // 5/300 ≈ 0.017, fails the antispam gate despite the bigger number.
    await insertRawMentions(clickhouse, makeMentions('promo', 300, 5, RECENT, 'es', 2000))
    // Niche: perfect 1:1 ratio, but only 40 unique authors — one short of...
    // well short of MIN_UNIQUE_AUTHORS (50).
    await insertRawMentions(clickhouse, makeMentions('nicho', 40, 40, RECENT, 'es', 3000))
    expect(40).toBeLessThan(MIN_UNIQUE_AUTHORS)

    const repository = createTrendsRepository(clickhouse, db)
    const stats = await repository.fetchHashtagStats()
    const ranked = rankHashtags(GLOBAL_TREND_SCOPE, stats, new Set())
    await repository.replaceSnapshot([GLOBAL_TREND_SCOPE], ranked, new Date())

    const snapshot = await db.select().from(trendingTopics).orderBy(trendingTopics.score)
    const hashtags = snapshot.map((row) => row.hashtag)
    expect(hashtags).toContain('mundial')
    expect(hashtags).not.toContain('promo')
    expect(hashtags).not.toContain('nicho')
  })

  it('computes count1h/uniqueAuthors/baseline from the right windows via real ClickHouse aggregation', async () => {
    // 120 mentions in the last hour from 60 authors...
    await insertRawMentions(clickhouse, makeMentions('mundial', 120, 60, RECENT, 'es', 4000))
    // ...plus 334 more in the preceding 167h (baseline window) — averages
    // to exactly 2/hour, so baselineHourly should come back as 2, not
    // folded into count1h and not using all 168h.
    await insertRawMentions(clickhouse, makeMentions('mundial', 334, 60, BASELINE, 'es', 5000))
    // A mention from over 7 days ago must not count toward *either* figure.
    await insertRawMentions(
      clickhouse,
      makeMentions('mundial', 50, 50, 8 * 24 * ONE_HOUR_MS, 'es', 6000),
    )

    const repository = createTrendsRepository(clickhouse, db)
    const [stats] = await repository.fetchHashtagStats()

    expect(stats?.hashtag).toBe('mundial')
    expect(stats?.count1h).toBe(120)
    expect(stats?.uniqueAuthors1h).toBe(60)
    expect(stats?.baselineWindowCount).toBe(334)
  })

  it('segments by language — a lang-scoped fetch excludes mentions in other languages', async () => {
    await insertRawMentions(clickhouse, makeMentions('mundial', 60, 60, RECENT, 'es', 7000))
    await insertRawMentions(clickhouse, makeMentions('worldcup', 60, 60, RECENT, 'en', 8000))

    const repository = createTrendsRepository(clickhouse, db)
    const esStats = await repository.fetchHashtagStats('es')
    const enStats = await repository.fetchHashtagStats('en')
    const globalStats = await repository.fetchHashtagStats()

    expect(esStats.map((r) => r.hashtag)).toEqual(['mundial'])
    expect(enStats.map((r) => r.hashtag)).toEqual(['worldcup'])
    expect(globalStats.map((r) => r.hashtag).sort()).toEqual(['mundial', 'worldcup'])
  })

  it('discovers active languages from mentions in the last hour only', async () => {
    await insertRawMentions(clickhouse, makeMentions('mundial', 60, 60, RECENT, 'es', 9000))
    // Old enough to be outside the "active" window this run cares about.
    await insertRawMentions(clickhouse, makeMentions('viejo', 60, 60, BASELINE, 'fr', 10_000))

    const repository = createTrendsRepository(clickhouse, db)
    const active = await repository.fetchActiveLanguages()

    expect(active).toEqual(['es'])
  })

  it('clears a scope that had a previous snapshot but has nothing qualifying this run', async () => {
    const repository = createTrendsRepository(clickhouse, db)
    // Seed a stale snapshot as if a previous run found something for 'fr'.
    await repository.replaceSnapshot(
      ['fr'],
      [{ scope: 'fr', hashtag: 'ancien', score: 5, postCount1h: 100, uniqueAuthors1h: 60 }],
      new Date(),
    )
    let stale = await db.select().from(trendingTopics)
    expect(stale.map((r) => r.hashtag)).toEqual(['ancien'])

    // This run recomputes 'fr' and finds nothing (table's empty in
    // ClickHouse) — replaceSnapshot still has to include 'fr' in `scopes`
    // for the stale row to actually go away.
    await repository.replaceSnapshot(['fr'], [], new Date())

    stale = await db.select().from(trendingTopics)
    expect(stale).toEqual([])
  })
})
