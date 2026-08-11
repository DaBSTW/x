import { bigint, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
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
