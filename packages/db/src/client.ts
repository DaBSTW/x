import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as authSchema from './schema/auth.js'
import * as conversationsSchema from './schema/conversations.js'
import * as interactionsSchema from './schema/interactions.js'
import * as listsSchema from './schema/lists.js'
import * as mediaSchema from './schema/media.js'
import * as notificationsSchema from './schema/notifications.js'
import * as postsSchema from './schema/posts.js'
import * as socialGraphSchema from './schema/social-graph.js'
import * as usersSchema from './schema/users.js'

export const schema = {
  ...usersSchema,
  ...socialGraphSchema,
  ...postsSchema,
  ...authSchema,
  ...interactionsSchema,
  ...notificationsSchema,
  ...mediaSchema,
  ...listsSchema,
  ...conversationsSchema,
}

export type Database = ReturnType<typeof createDatabase>

/**
 * Creates a Drizzle client bound to `connectionString`.
 *
 * One instance per process — the underlying `postgres` client pools
 * connections internally, so callers should not create a new instance per
 * request (CODESTYLE.md §8.4, §13).
 *
 * SPECS.md §14.4's "BD 2 s" is deliberately *not* configured here as a
 * per-connection option (an earlier version of this comment described one)
 * — measured empirically, not assumed: postgres.js's `connection.
 * statement_timeout` sends it as a Postgres *startup parameter*, and this
 * repo's own PgBouncer (docker-compose.yml, transaction-mode) rejects any
 * connection that sends it outright — a FATAL "unsupported startup
 * parameter: statement_timeout", not a soft "the timeout silently doesn't
 * apply". Since PgBouncer is the real app-facing DATABASE_URL for exactly
 * the horizontally-scaled deployment SPECS.md §14.4 is written for, a
 * per-connection option here would work in this sandbox's own local-dev
 * default (a direct connection) and break the one topology it matters most
 * for. The budget lives in Postgres itself instead — migrations/
 * 0018_*.sql's `ALTER ROLE CURRENT_USER SET statement_timeout` — which
 * Postgres applies at authentication time for *every* future connection
 * as this role, direct or through any proxy, with nothing for this client
 * (or any other role-using process) to configure at all. migrate.ts/
 * seed/run.ts explicitly opt back out of it for their own session, since
 * they're the one place in this codebase that legitimately needs to run
 * something slower.
 */
export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    // Matches PgBouncer's `transaction` pooling mode target from SPECS.md §14.2.
    max: 20,
    // SPECS.md §14.4's "nunca timeout infinito" — connection *establishment*
    // specifically (this repo's role-level statement_timeout, see this
    // function's own comment, covers query execution once connected). Same
    // 2s budget; postgres.js takes this one in whole seconds, not ms.
    connect_timeout: 2,
    // SPECS.md §14.2's PgBouncer sits in `transaction` mode — a "session"
    // can hop between different underlying Postgres connections between
    // statements, so a prepared statement created on one physical
    // connection can be gone (or belong to someone else's transaction) by
    // the time postgres.js tries to reuse it on the next query. In practice
    // this rarely reaches the caller as a hard error — modern PgBouncer
    // (>=1.21) can transparently re-prepare on the fly, and even without
    // that, postgres.js's own connection.js silently retries the specific
    // Postgres error routine this produces — but both of those are safety
    // nets this client never explicitly opted into, and every occurrence
    // still costs a real extra round trip, invisible unless something hooks
    // the wire protocol directly (client.pgbouncer.integration.test.ts
    // does exactly that, against a real PgBouncer with its own tracking
    // deliberately disabled, to prove the retries are real and not just
    // theoretical). Disabling auto-prepare here removes the dependency on
    // either safety net entirely, and makes this client safe to point at
    // either a direct Postgres connection (this costs a little: every
    // query is planned fresh) or a PgBouncer transaction-mode one, without
    // a second code path for which is which.
    prepare: false,
  })
  return drizzle(client, { schema })
}
