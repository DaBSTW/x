import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDatabase } from './client.js'
import { migrationsFolderUrl } from './migrations-path.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  // Configuration is validated at process start, not on first use — CODESTYLE.md §8.4.
  throw new Error('DATABASE_URL is required to run migrations')
}

const db = createDatabase(connectionString)

// migrations/0018_*.sql sets a role-level statement_timeout default
// (ROADMAP.md 3.5a) — once that migration has run once, every later
// invocation of this same script (including this one, for whatever
// migration runs *after* 0018) would otherwise inherit it too, and DDL like
// CREATE INDEX CONCURRENTLY on a real production-sized table can
// legitimately take far longer. Unset for this script's own session only —
// a role-level default is exactly that, a *default*, and this overrides it
// for the connection that's about to do the one thing in this codebase
// that needs to.
await db.execute(sql`set statement_timeout = 0`)

await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

// biome-ignore lint/suspicious/noConsoleLog: script output, not a running service — CODESTYLE.md §8.1 scopes the console.log ban to services.
console.log('migrations applied')
process.exit(0)
