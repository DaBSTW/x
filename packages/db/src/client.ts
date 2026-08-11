import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as authSchema from './schema/auth.js'
import * as postsSchema from './schema/posts.js'
import * as socialGraphSchema from './schema/social-graph.js'
import * as usersSchema from './schema/users.js'

export const schema = {
  ...usersSchema,
  ...socialGraphSchema,
  ...postsSchema,
  ...authSchema,
}

export type Database = ReturnType<typeof createDatabase>

/**
 * Creates a Drizzle client bound to `connectionString`.
 *
 * One instance per process — the underlying `postgres` client pools
 * connections internally, so callers should not create a new instance per
 * request (CODESTYLE.md §8.4, §13).
 */
export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    // Matches PgBouncer's `transaction` pooling mode target from SPECS.md §14.2.
    max: 20,
  })
  return drizzle(client, { schema })
}
