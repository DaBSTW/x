import { sql } from 'drizzle-orm'
import { bigint, check, index, pgTable, primaryKey, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.js'

export const follows = pgTable(
  'follows',
  {
    followerId: bigint('follower_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followeeId: bigint('followee_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followeeId] }),
    check('no_self_follow', sql`${table.followerId} <> ${table.followeeId}`),
    // Fan-out reads "who follows this author" — see SPECS.md §6.1.
    index('idx_follows_followee').on(table.followeeId, table.createdAt.desc()),
  ],
)

export type Follow = typeof follows.$inferSelect
export type NewFollow = typeof follows.$inferInsert

// Table + endpoints from ROADMAP.md 1.2; posts.service.ts, timeline.service.ts
// and apps/workers' notifications worker apply it to reads (ROADMAP.md 2.6).
export const blocks = pgTable(
  'blocks',
  {
    blockerId: bigint('blocker_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: bigint('blocked_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.blockerId, table.blockedId] }),
    check('no_self_block', sql`${table.blockerId} <> ${table.blockedId}`),
    // "who has blocked me" — phase 2's filtering needs this direction too,
    // not just "who have I blocked" (which the primary key already serves).
    index('idx_blocks_blocked').on(table.blockedId),
  ],
)
export type Block = typeof blocks.$inferSelect
export type NewBlock = typeof blocks.$inferInsert

// No reverse index like blocks' — muting is silent and one-directional by
// design (SPECS.md), so "who has muted me" is never a real query.
export const mutes = pgTable(
  'mutes',
  {
    muterId: bigint('muter_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mutedId: bigint('muted_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.muterId, table.mutedId] }),
    check('no_self_mute', sql`${table.muterId} <> ${table.mutedId}`),
  ],
)
export type Mute = typeof mutes.$inferSelect
export type NewMute = typeof mutes.$inferInsert
