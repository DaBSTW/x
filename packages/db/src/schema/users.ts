import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
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
    isSuspended: boolean('is_suspended').notNull().default(false),
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
export const userCounters = pgTable('user_counters', {
  userId: bigint('user_id', { mode: 'bigint' })
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  followersCount: integer('followers_count').notNull().default(0),
  followingCount: integer('following_count').notNull().default(0),
  postsCount: integer('posts_count').notNull().default(0),
  likesCount: integer('likes_count').notNull().default(0),
})

export type UserCounters = typeof userCounters.$inferSelect
export type NewUserCounters = typeof userCounters.$inferInsert
