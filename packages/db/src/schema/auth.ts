import { bigint, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.js'

// A refresh token family shares `sessionId`. Rotation replaces one row with
// the next in the chain; reuse of an already-rotated token revokes the whole
// family — SPECS.md §11.1.
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    userId: bigint('user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: bigint('session_id', { mode: 'bigint' }).notNull(),
    // SHA-256 of the opaque token — the raw value never touches the database.
    tokenHash: text('token_hash').notNull().unique(),
    replacedByHash: text('replaced_by_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // Last-seen device/IP metadata surfaced by `GET /auth/sessions`.
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
  },
  (table) => [
    index('idx_refresh_tokens_user').on(table.userId, table.createdAt.desc()),
    index('idx_refresh_tokens_session').on(table.sessionId),
  ],
)

export type RefreshToken = typeof refreshTokens.$inferSelect
export type NewRefreshToken = typeof refreshTokens.$inferInsert

export const emailVerificationTokens = pgTable('email_verification_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: bigint('user_id', { mode: 'bigint' })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert

// Same one-time-use shape as emailVerificationTokens — SPECS.md §5.4's
// POST /auth/password/forgot + /reset (ROADMAP.md 0.4, closing a gap SPECS
// lists under MVP that never actually got built alongside the rest of it).
export const passwordResetTokens = pgTable('password_reset_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: bigint('user_id', { mode: 'bigint' })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert

// One row per user. `confirmedAt` NULL means "setup started, not yet proven
// against a real code" (ROADMAP.md 2.6) — login only ever consults a
// confirmed row, so a pending, unconfirmed secret never gates anything. A
// fresh POST /auth/2fa/setup overwrites this row (upsert), the same
// "starting over is always safe" posture as re-requesting a password reset
// link. `lastUsedTimeStep` blocks replaying the same still-valid code twice
// (RFC 6238 doesn't require this — otplib's `afterTimeStep` supports it for
// free). The secret itself is plaintext, not hashed like every other token
// in this file: verifying a live TOTP code needs it back, unlike a
// one-time link where only ever proving *possession* matters.
export const twoFactorSecrets = pgTable('two_factor_secrets', {
  userId: bigint('user_id', { mode: 'bigint' })
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  lastUsedTimeStep: integer('last_used_time_step'),
})

export type TwoFactorSecret = typeof twoFactorSecrets.$inferSelect
export type NewTwoFactorSecret = typeof twoFactorSecrets.$inferInsert

// Single-use recovery codes, hashed at rest like every other one-time token
// here — SPECS.md §5.4's "códigos de recuperación de un solo uso" for
// signing in with a lost authenticator device.
export const twoFactorRecoveryCodes = pgTable(
  'two_factor_recovery_codes',
  {
    codeHash: text('code_hash').primaryKey(),
    userId: bigint('user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [index('idx_2fa_recovery_codes_user').on(table.userId)],
)

export type TwoFactorRecoveryCode = typeof twoFactorRecoveryCodes.$inferSelect
export type NewTwoFactorRecoveryCode = typeof twoFactorRecoveryCodes.$inferInsert

// The bridge between "password checked out" and "session issued" when 2FA
// is on: POST /auth/login returns one of these instead of a token pair;
// POST /auth/2fa/login exchanges it (+ a TOTP or recovery code) for the
// real thing. Deliberately the same one-time hashed-in-DB shape as
// emailVerificationTokens/passwordResetTokens above rather than another JWT
// — a stolen access-token signing key shouldn't *also* be able to forge
// "this caller already proved their password" claims.
export const twoFactorChallenges = pgTable('two_factor_challenges', {
  tokenHash: text('token_hash').primaryKey(),
  userId: bigint('user_id', { mode: 'bigint' })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

export type TwoFactorChallenge = typeof twoFactorChallenges.$inferSelect
export type NewTwoFactorChallenge = typeof twoFactorChallenges.$inferInsert
