/**
 * SPECS.md §14.4's four numbers ("Timeouts explícitos... Nunca timeout
 * infinito"), defined once and reused everywhere something needs
 * configuring — never re-invented per call site. Applied via each
 * dependency's own native timeout mechanism wherever one exists
 * (postgres.js's connect_timeout/statement_timeout, ioredis's
 * commandTimeout, kafkajs's requestTimeout — all of them client
 * *and, for Postgres, server*-enforced, not just this process giving up on
 * waiting), and via withTimeout below only for the few dependencies (the
 * external SDKs) that expose no native option of their own.
 */
export const DATABASE_TIMEOUT_MS = 2000
export const REDIS_TIMEOUT_MS = 200
export const INTERNAL_CALL_TIMEOUT_MS = 1000
export const EXTERNAL_CALL_TIMEOUT_MS = 5000

export class TimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * Races `promise` against a timer, for the calls that can't set their own
 * native timeout — an SDK with no timeout option of its own (resend,
 * firebase-admin, @parse/node-apn; see push-sender.ts/mailer.ts's own use
 * of this). Prefer a callee's own native timeout when it has one: those
 * actually abort the underlying work (server-side, for a database query —
 * see packages/db/src/client.ts's statement_timeout), where this can only
 * ever stop *waiting* for a promise that keeps running to completion
 * regardless, doing nothing about whatever resource it's still holding —
 * the fallback for when there's nothing better, never the first choice.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, timeoutMs)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
