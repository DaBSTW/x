import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDatabase } from './client.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  // Configuration is validated at process start, not on first use — CODESTYLE.md §8.4.
  throw new Error('DATABASE_URL is required to run migrations')
}

const db = createDatabase(connectionString)

await migrate(db, { migrationsFolder: new URL('../migrations', import.meta.url).pathname })

// biome-ignore lint/suspicious/noConsoleLog: script output, not a running service — CODESTYLE.md §8.1 scopes the console.log ban to services.
console.log('migrations applied')
process.exit(0)
