import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { citext } from './custom-types.js'

export const users = pgTable(
  'users',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    username: varchar('username', { length: 15 }).notNull(),
    usernameLower: varchar('username_lower', { length: 15 }).notNull().unique(),
    email: citext('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    // NULL when the account only has OAuth identities attached.
    passwordHash: text('password_hash'),
    displayName: varchar('display_name', { length: 50 }).notNull(),
    bio: varchar('bio', { length: 160 }),
    location: varchar('location', { length: 30 }),
    websiteUrl: text('website_url'),
    avatarUrl: text('avatar_url'),
    bannerUrl: text('banner_url'),
    birthDate: date('birth_date'),
    isProtected: boolean('is_protected').notNull().default(false),
    // Who can start a 1:1 DM with this user — 0 everyone, 1 followed only
    // (ROADMAP.md 2.5). Same 0/1 convention as posts.reply_policy.
    dmPrivacy: smallint('dm_privacy').notNull().default(0),
    isVerified: boolean('is_verified').notNull().default(false),
    // Declared since 0.3, wired up in ROADMAP.md 3.3: blocks login
    // (auth.service.ts) and every write path a suspended account could
    // still reach through an already-issued token.
    isSuspended: boolean('is_suspended').notNull().default(false),
    // ROADMAP.md 3.3 — SPECS.md §12.2's "Modo lectura" (12h–7d): null means
    // not currently restricted; a past timestamp is equivalent to null
    // (no cleanup job needed, every check compares against `now()`).
    readOnlyUntil: timestamp('read_only_until', { withTimezone: true }),
    // SPECS.md §12.2's "Baneo permanente" — distinct from isSuspended
    // (apelable, reversible, "cuenta inaccesible") in name and effect
    // ("cuenta cerrada" — a banned account's email stays taken by this row
    // forever, the honest scope of "hash de dispositivo/email bloqueado"
    // this checkpoint implements: no device-fingerprinting mechanism
    // exists anywhere in this codebase to hash in the first place, and
    // with no account-deletion flow yet (ROADMAP.md 3.7) a banned row is
    // never removed, so its email's own unique constraint already blocks
    // re-registration without a separate hash table).
    isBanned: boolean('is_banned').notNull().default(false),
    // ROADMAP.md 3.3 — the whole of this app's RBAC: one flag, not a roles/
    // permissions table. Honest minimum for "who can open apps/admin and
    // apply a moderation action" — nothing in SPECS.md asks for graduated
    // admin roles (senior vs junior moderator, etc.), so building one
    // wouldn't be closing a real requirement, just speculative scope.
    // Never settable through any API this app exposes — SQL only, the same
    // posture a first admin account already needs in any app with no
    // public sign-up-as-admin path.
    isModerator: boolean('is_moderator').notNull().default(false),
    lang: varchar('lang', { length: 8 }).notNull().default('es'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [check('username_format', sql`${table.username} ~ '^[A-Za-z0-9_]{1,15}$'`)],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

// Split from `users` so a like/follow spike doesn't contend for row locks on
// the identity row (CODESTYLE.md §13, SPECS.md §4.2).
export const userCounters = pgTable(
  'user_counters',
  {
    userId: bigint('user_id', { mode: 'bigint' })
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    followersCount: integer('followers_count').notNull().default(0),
    followingCount: integer('following_count').notNull().default(0),
    postsCount: integer('posts_count').notNull().default(0),
    likesCount: integer('likes_count').notNull().default(0),
  },
  (table) => [
    // ROADMAP.md 3.4e's query audit — social-graph.repository.ts's "who to
    // follow" suggestions sorts by this column with no other selective
    // filter (the follow/block anti-joins exclude rows, they don't narrow
    // by a value an index could seek on), so without this the planner has
    // no way to avoid scanning and sorting every row in the table before
    // ever reaching LIMIT — the one query in that audit whose cost scales
    // with total registered users rather than a per-entity fan-out/count.
    //
    // .nullsFirst(), deliberately not drizzle's own .desc() default of
    // NULLS LAST: a plain SQL `ORDER BY x DESC` with no explicit NULLS
    // clause means NULLS FIRST (Postgres's own documented default), and an
    // index built NULLS LAST cannot satisfy that ordering directly no
    // matter how well it otherwise matches — Postgres's planner treats
    // that as a genuinely different sort order, not something a NOT NULL
    // constraint on this column (true here, but the planner doesn't
    // exploit it for this) papers over. Found the hard way: the first
    // version of this index (plain .desc()) measured *no better* than no
    // index at all — still a full Seq Scan of both `users` and
    // `user_counters` even with `enable_seqscan=off`, because there was no
    // matching-order plan available, not because the planner preferred
    // the scan. Matching the NULLS clause is what actually mattered — the
    // same query stayed at ~14ms (full scan-and-sort) until this was
    // corrected, then consistently ran in under 1ms (an Index Scan bounded
    // by LIMIT, not table size) across repeated runs and repeated ANALYZEs
    // — confirmed against a real seeded database (8,000 users).
    index('idx_user_counters_followers').on(table.followersCount.desc().nullsFirst()),
  ],
)

export type UserCounters = typeof userCounters.$inferSelect
export type NewUserCounters = typeof userCounters.$inferInsert
