import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { isUniqueConstraintViolation } from './errors.js'

/**
 * postgres.PostgresError's *type* declares only the inherited
 * `Error(message?, options?)` constructor — the object-shaped constructor
 * the real `postgres` package actually uses internally to build one from
 * Postgres' own ErrorResponse fields (severity, code, ...) isn't part of
 * its public .d.ts. Building one the same way the package itself does at
 * runtime (a bare Error, then assigning the extra fields directly — plain
 * assignable properties, not constructor-validated) keeps this a real
 * `instanceof postgres.PostgresError` without fighting that type gap.
 * Mirrors exactly the shape Postgres itself sent for the real
 * likes_user_id_post_id_pk violation ROADMAP.md 3.4h's k6 campaign actually
 * triggered (see errors.ts's own comment), not an invented one.
 */
function fakePostgresError(code: string, constraintName?: string): postgres.PostgresError {
  const error = new postgres.PostgresError('duplicate key value violates unique constraint')
  error.code = code
  if (constraintName !== undefined) error.constraint_name = constraintName
  return error
}

describe('isUniqueConstraintViolation', () => {
  it('is true for a 23505 with no constraint name filter given', () => {
    expect(
      isUniqueConstraintViolation(fakePostgresError('23505', 'likes_user_id_post_id_pk')),
    ).toBe(true)
  })

  it('is true when the constraint name filter matches exactly', () => {
    expect(
      isUniqueConstraintViolation(
        fakePostgresError('23505', 'likes_user_id_post_id_pk'),
        'likes_user_id_post_id_pk',
      ),
    ).toBe(true)
  })

  it('is false when the constraint name filter names a different constraint', () => {
    expect(
      isUniqueConstraintViolation(
        fakePostgresError('23505', 'bookmarks_user_id_post_id_pk'),
        'likes_user_id_post_id_pk',
      ),
    ).toBe(false)
  })

  it('is false for a Postgres error that is not a unique-violation (wrong SQLSTATE)', () => {
    // 23503 = foreign_key_violation — a real, different SQLSTATE, not a
    // made-up one, to prove this checks the actual code rather than just
    // "some PostgresError happened".
    expect(
      isUniqueConstraintViolation(fakePostgresError('23503', 'likes_user_id_post_id_pk')),
    ).toBe(false)
  })

  it('is false for a plain Error that merely happens to carry a matching .code property', () => {
    // The whole reason this checks `instanceof postgres.PostgresError`
    // instead of duck-typing `error.code === '23505'` — a differently-
    // shaped error must never be mistaken for a real constraint violation.
    const lookalike = Object.assign(new Error('not really a PostgresError'), {
      code: '23505',
      constraint_name: 'likes_user_id_post_id_pk',
    })
    expect(isUniqueConstraintViolation(lookalike, 'likes_user_id_post_id_pk')).toBe(false)
  })

  it('is false for undefined/non-error values', () => {
    expect(isUniqueConstraintViolation(undefined)).toBe(false)
    expect(isUniqueConstraintViolation('a string')).toBe(false)
  })
})
