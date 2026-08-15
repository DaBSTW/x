import { type Database, createDatabase } from './client.js'
import { markWroteDuringRequest, shouldPreferPrimary } from './read-write-context.js'

/**
 * SPECS.md §14.2: "todas las consultas de lectura van a réplicas, salvo
 * *read-your-writes*". Returns a Database exactly as far as every existing
 * repository in this codebase can tell — same public shape as
 * createDatabase's own return type, so nothing downstream of `app.db`
 * changes (CODESTYLE.md §8.4) — but every select/selectDistinct/
 * selectDistinctOn/query/with/$with call actually goes to a randomly
 * chosen replica *unless* read-write-context.ts's shouldPreferPrimary()
 * says otherwise for whatever request is currently in flight, and every
 * insert/update/delete/transaction both goes to the primary *and* marks
 * the current request as having written (so that request's own subsequent
 * reads switch to the primary too — read-your-writes within a single
 * request, not just across requests via the cookie apps/api's
 * read-write-routing plugin sets).
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
  } as Database
}
