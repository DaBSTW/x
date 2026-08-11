import { sql } from 'drizzle-orm'
import { createDatabase } from '../client.js'
import { postCounters, posts } from '../schema/posts.js'
import { follows } from '../schema/social-graph.js'
import { userCounters, users } from '../schema/users.js'
import { generateSeedData } from './generate.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database')
}

const db = createDatabase(connectionString)
const data = await generateSeedData(50, 500)

await db.transaction(async (tx) => {
  // Re-runnable: `pnpm db:seed` repopulates from scratch every time (README.md).
  await tx.execute(sql`TRUNCATE TABLE posts, post_counters, post_entities, users CASCADE`)

  await tx.insert(users).values(data.users)
  await tx.insert(userCounters).values(data.userCounters)
  await tx.insert(follows).values(data.follows)
  await tx.insert(posts).values(data.posts)
  await tx.insert(postCounters).values(data.postCounters)
})

// biome-ignore lint/suspicious/noConsoleLog: script output, not a running service — CODESTYLE.md §8.1 scopes the console.log ban to services.
console.log(
  `seeded ${data.users.length} users, ${data.follows.length} follows, ${data.posts.length} posts`,
)
process.exit(0)
