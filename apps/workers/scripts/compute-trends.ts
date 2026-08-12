// Scoring job (SPECS.md §10.4, ROADMAP.md 2.4), meant to run every 5
// minutes. Scheduling this (cron) is an ops concern, same as
// reconcile-counters.ts — see docs/adr/0003-despliegue.md.
import { createDatabase } from '@x/db'
import { GLOBAL_TREND_SCOPE } from '@x/utils'
import { parseEnv } from '../src/env.js'
import { createClickHouseClient } from '../src/trends/clickhouse-client.js'
import { rankHashtags } from '../src/trends/rank-hashtags.js'
import { type TrendSnapshotRow, createTrendsRepository } from '../src/trends/trends.repository.js'

const env = parseEnv(process.env)
const db = createDatabase(env.DATABASE_URL)
const clickhouse = createClickHouseClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
})
const repository = createTrendsRepository(clickhouse, db)

const blacklist = new Set(
  env.TRENDS_BLACKLIST_HASHTAGS.split(',')
    .map((tag) => tag.trim().toLowerCase().replace(/^#/, ''))
    .filter((tag) => tag.length > 0),
)

const startedAt = Date.now()

// The union of "had activity this run" and "had a snapshot from a previous
// run" — a scope that cools off (zero qualifying hashtags now) still needs
// its stale rows cleared, not just skipped, or GET /trends would keep
// serving last hour's trends forever for a language nobody's tweeting in
// anymore.
const [activeLanguages, existingScopes] = await Promise.all([
  repository.fetchActiveLanguages(),
  repository.fetchExistingScopes(),
])
const scopes = [...new Set([GLOBAL_TREND_SCOPE, ...activeLanguages, ...existingScopes])]

const allRows: TrendSnapshotRow[] = []
for (const scope of scopes) {
  const stats = await repository.fetchHashtagStats(scope === GLOBAL_TREND_SCOPE ? undefined : scope)
  allRows.push(...rankHashtags(scope, stats, blacklist))
}

await repository.replaceSnapshot(scopes, allRows, new Date())

console.info(
  `trends computed in ${Date.now() - startedAt}ms — ${allRows.length} rows across ${scopes.length} scopes (${scopes.join(', ')})`,
)

await clickhouse.close()
process.exit(0)
