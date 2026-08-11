// Nightly reconciliation job (SPECS.md §4.4, ROADMAP.md 1.4): recomputes
// post_counters from the source tables (likes, bookmarks, reposts, replies)
// for posts with activity in the last 24h, correcting any drift the 5s
// Redis flush missed. Scheduling this (cron) is an ops concern, not covered
// here — see docs/adr/0003-despliegue.md for how apps/workers is deployed.
import { createDatabase } from '@x/db'
import { createCountersRepository } from '../src/counters/counters.repository.js'
import { parseEnv } from '../src/env.js'

const env = parseEnv(process.env)
const db = createDatabase(env.DATABASE_URL)
const repository = createCountersRepository(db)

const startedAt = Date.now()
await repository.reconcileRecentPosts()
console.info(`counters reconciled in ${Date.now() - startedAt}ms`)
process.exit(0)
