import postgres from 'postgres'

/**
 * True when `error` is a genuine unique-constraint violation from Postgres
 * (SQLSTATE 23505) — narrowed to a specific constraint name when the caller
 * passes one, since a service usually wants to translate *its own*
 * check-then-insert race into a domain-specific conflict, not swallow every
 * unrelated unique violation a query might ever raise.
 *
 * Real production bug found by ROADMAP.md 3.4h's k6 load campaign, not
 * theorized: interactions.service.ts's like()/bookmark() each did a
 * findX()-then-insertX() check — inherently racy under genuine concurrency,
 * since two requests for the same (userId, postId) can both pass the find
 * before either commits its insert. Postgres always caught the second
 * insert correctly via this exact constraint (verified in the campaign's
 * own server log — every occurrence named `likes_user_id_post_id_pk`), but
 * nothing translated that into the ConflictError the routes' own response
 * schema already promised (409), so it fell through error-handler.ts's
 * catch-all and surfaced as a raw 500 instead. `postgres.PostgresError`
 * (not a hand-rolled `error.code === '23505'` duck-type) so a
 * differently-shaped error — including one that merely happens to carry a
 * `.code` property — can never be mistaken for this.
 */
export function isUniqueConstraintViolation(error: unknown, constraintName?: string): boolean {
  if (!(error instanceof postgres.PostgresError)) return false
  if (error.code !== '23505') return false
  return constraintName === undefined || error.constraint_name === constraintName
}
