import { type Database, createDatabase } from './client.js'
import { markWroteDuringRequest, shouldPreferPrimary } from './read-write-context.js'

/**
 * SPECS.md §14.2: "todas las consultas de lectura van a réplicas, salvo
 * *read-your-writes*". Returns a Database exactly as far as every existing
 * repository in this codebase can tell — same public shape as
 * createDatabase's own return type, so nothing downstream of `app.db`
 * changes (CODESTYLE.md §8.4) — but every select/selectDistinct/
 * selectDistinctOn/query/with/$with/$count call actually goes to a randomly
 * chosen replica *unless* read-write-context.ts's shouldPreferPrimary()
 * says otherwise for whatever request is currently in flight, and every
 * insert/update/delete/transaction/execute/refreshMaterializedView both
 * goes to the primary *and* marks the current request as having written
 * (so that request's own subsequent reads switch to the primary too —
 * read-your-writes within a single request, not just across requests via
 * the cookie apps/api's read-write-routing plugin sets).
 *
 * Every one of drizzle's own `PostgresJsDatabase` methods is listed
 * explicitly below, deliberately — `...primary` only carries over
 * *own-enumerable* properties (drizzle's internal `dialect`/`session`/`_`/
 * `$client` state, real properties this object genuinely needs), never
 * `primary`'s actual query methods: those live on its prototype chain, so
 * the spread alone silently drops them. Caught for real, not by
 * inspection: `execute` was missing from this list until
 * ROADMAP.md 3.5a's own migrate.ts/seed/run.ts opt-out pattern needed it in
 * a test, and `app.db.execute is not a function` surfaced the gap
 * immediately.
 *
 * Deliberately hand-rolled rather than drizzle-orm/pg-core's own
 * `withReplicas` helper: its random-replica-pick default is all this
 * needed from it, and re-exposing its return value (a generic
 * `Q & { $primary: Q }` intersection) through this function's own
 * `Database`-typed signature fights TypeScript's spread-type inference
 * for no real benefit — one target picked per call plus a plain object
 * literal gets the identical runtime behavior with a signature that's
 * just `Database` end to end.
 *
 * `replicaUrls: []` — local dev by .env.example's own default
 * (docker-compose.yml's postgres-replica has the full reasoning), and
 * nothing here forces a deployment to run a replica just to boot — reads
 * simply always target the primary too (readTarget's own empty-array
 * check below), the same outcome plain createDatabase would give, but
 * still through the write-tracking wrapper. That distinction matters:
 * apps/api's read-write-routing plugin still needs an accurate
 * didWriteDuringRequest() on every write regardless of whether a replica
 * exists to route away from — a single-primary deployment (or this
 * function's own tests, which don't need to stand up a real replica to
 * exercise the cookie plugin) should behave identically to one that adds a
 * replica later, not silently skip write-tracking whenever the replica
 * list happens to be empty. apps/workers/ws-gateway never call this
 * function at all (their own server.ts/app.ts use plain createDatabase —
 * near-entirely-write workloads with no per-request context to track
 * against in the first place), so this only ever runs inside apps/api.
 */
export function createReplicatedDatabase(primaryUrl: string, replicaUrls: string[] = []): Database {
  const primary = createDatabase(primaryUrl)
  const replicas = replicaUrls.map((url) => createDatabase(url))

  // One pick per call, used consistently for that whole call — never called
  // twice for what should be a single logical target (that would risk
  // picking two *different* random replicas for what's supposed to be one
  // read).
  function readTarget(): Database {
    if (shouldPreferPrimary() || replicas.length === 0) return primary
    return replicas[Math.floor(Math.random() * replicas.length)] as Database
  }

  return {
    ...primary,
    select: (...args: Parameters<Database['select']>) => readTarget().select(...args),
    selectDistinct: (...args: Parameters<Database['selectDistinct']>) =>
      readTarget().selectDistinct(...args),
    selectDistinctOn: (...args: Parameters<Database['selectDistinctOn']>) =>
      readTarget().selectDistinctOn(...args),
    with: (...args: Parameters<Database['with']>) => readTarget().with(...args),
    $with: (...args: Parameters<Database['$with']>) => readTarget().$with(...args),
    // count(*) can only ever read — no separate write-tracked branch needed.
    $count: (...args: Parameters<Database['$count']>) => readTarget().$count(...args),
    get query() {
      return readTarget().query
    },
    insert: (...args: Parameters<Database['insert']>) => {
      markWroteDuringRequest()
      return primary.insert(...args)
    },
    update: (...args: Parameters<Database['update']>) => {
      markWroteDuringRequest()
      return primary.update(...args)
    },
    delete: (...args: Parameters<Database['delete']>) => {
      markWroteDuringRequest()
      return primary.delete(...args)
    },
    // Conservative by construction: a transaction is marked as a write even
    // if every statement inside it turns out to be a read — this codebase
    // never uses transaction() for a read-only multi-statement query
    // (grep confirms every real transaction() call site across apps/api,
    // the only consumer of this function, is a multi-step write), and the
    // failure mode of the assumption ever being wrong is just a few extra
    // reads routed to the primary, never a correctness bug.
    transaction: (...args: Parameters<Database['transaction']>) => {
      markWroteDuringRequest()
      return primary.transaction(...args)
    },
    // Raw SQL is a generic escape hatch — could be a read or a write, and
    // unlike transaction() above there's no call-site convention here to
    // lean on. Same conservative default as transaction(): a write
    // misrouted to a replica is a correctness bug (replicas reject writes
    // outright), a read misrouted to the primary is just a missed
    // optimization — the asymmetry, not an assumption about what most
    // callers actually do with it, is why this defaults to primary.
    execute: (...args: Parameters<Database['execute']>) => {
      markWroteDuringRequest()
      return primary.execute(...args)
    },
    // Modifies the view's own contents — a write in every sense that
    // matters here, same reasoning as execute() above.
    refreshMaterializedView: (...args: Parameters<Database['refreshMaterializedView']>) => {
      markWroteDuringRequest()
      return primary.refreshMaterializedView(...args)
    },
    // Structurally correct at runtime (every method above is a real,
    // matching drizzle method) but TS's structural check on this many
    // overlapping call signatures at once is stricter than a plain `as
    // Database` tolerates — same "verified by hand, tell TS to stop
    // fighting itself" posture as opensearch-client.ts's own `loosely<T>`.
  } as unknown as Database
}
