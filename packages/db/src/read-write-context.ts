import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * SPECS.md §14.2's read-your-writes window, threaded through
 * createReplicatedDatabase's wrapped select/insert/update/delete without
 * changing a single repository's call signature (CODESTYLE.md §8.4-style
 * transparency) — every repository in this codebase already receives one
 * `db: Database` built once at boot (apps/api's app.ts, `app.db`), never a
 * per-request instance, so the only place left to carry "should *this*
 * request's reads prefer the primary" is ambient async context, not a
 * function parameter.
 *
 * apps/api's read-write-routing plugin is the only intended caller of
 * runWithReadWriteContext/didWriteDuringRequest (one per HTTP request);
 * createReplicatedDatabase is the only intended caller of
 * shouldPreferPrimary/markWroteDuringRequest (one per query). Outside of a
 * request — apps/workers, scripts, any test using plain createDatabase —
 * there is no active context, and every function here degrades to "no
 * preference" (shouldPreferPrimary: false) rather than throwing, so nothing
 * outside apps/api needs to know this exists at all.
 */
type ReadWriteContext = {
  /** True if the incoming request already carried the read-your-writes cookie. */
  startedWithPrimaryCookie: boolean
  /**
   * Flipped the moment *this* request performs its first write — makes
   * every subsequent read in the same request prefer the primary too, so a
   * request that writes and then immediately reads back its own write never
   * races a replica that has not caught up yet, even on a request that
   * started without the cookie (the very first write of a session).
   */
  wroteDuringRequest: boolean
}

const storage = new AsyncLocalStorage<ReadWriteContext>()

/**
 * apps/api's read-write-routing plugin wraps each request's entire
 * lifecycle in this from an `onRequest` hook, via `storage.enterWith` (not
 * `.run`, deliberately — see that plugin's own comment for why `.run`'s
 * synchronous-callback scoping doesn't fit Fastify's hook-per-lifecycle-
 * stage model the way `enterWith`'s "persist through the rest of this
 * async chain" does).
 */
export function enterReadWriteContext(startedWithPrimaryCookie: boolean): void {
  storage.enterWith({ startedWithPrimaryCookie, wroteDuringRequest: false })
}

/** createReplicatedDatabase's wrapped insert/update/delete/transaction call this. */
export function markWroteDuringRequest(): void {
  const context = storage.getStore()
  if (context) context.wroteDuringRequest = true
}

/** createReplicatedDatabase's wrapped select/selectDistinct/selectDistinctOn/query/with/$with call this. */
export function shouldPreferPrimary(): boolean {
  const context = storage.getStore()
  return context !== undefined && (context.startedWithPrimaryCookie || context.wroteDuringRequest)
}

/**
 * apps/api's read-write-routing plugin reads this from an `onSend` hook,
 * after the handler has run — only a write *during this request* should
 * (re)set the 5 s cookie; a request that merely started with the cookie
 * already set (and performed no new write) should let it run out rather
 * than perpetually extending it on every read, matching SPECS.md §14.2's
 * "durante 5 s tras una escritura" literally: 5 s after the last write, not
 * 5 s after the last read.
 */
export function didWriteDuringRequest(): boolean {
  return storage.getStore()?.wroteDuringRequest ?? false
}
