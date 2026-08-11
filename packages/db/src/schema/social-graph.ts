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
