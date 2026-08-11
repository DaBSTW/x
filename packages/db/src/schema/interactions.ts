import { bigint, index, pgTable, primaryKey, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.js'

// `postId` has no FK — same reason post_counters/post_entities don't have
// one: `posts` is partitioned with primary key (id, created_at), and a
// partitioned table's non-partition-key column can't be an FK target.

export const likes = pgTable(
  'likes',
  {
    userId: bigint('user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: bigint('post_id', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.postId] }),
    index('idx_likes_post').on(table.postId, table.createdAt.desc()),
    // "posts a user liked, newest first" — the PK alone orders by postId
    // within a user, not by time.
    index('idx_likes_user').on(table.userId, table.createdAt.desc()),
  ],
)

export type Like = typeof likes.$inferSelect
export type NewLike = typeof likes.$inferInsert

export const bookmarks = pgTable(
  'bookmarks',
  {
    userId: bigint('user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: bigint('post_id', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.postId] }),
    index('idx_bookmarks_post').on(table.postId, table.createdAt.desc()),
    // Backs GET /timeline/bookmarks (ROADMAP.md 1.3's route table; not yet implemented).
    index('idx_bookmarks_user').on(table.userId, table.createdAt.desc()),
  ],
)

export type Bookmark = typeof bookmarks.$inferSelect
export type NewBookmark = typeof bookmarks.$inferInsert
