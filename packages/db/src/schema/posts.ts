import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users.js'

export const postKind = pgEnum('post_kind', ['original', 'reply', 'repost', 'quote'])

// `posts` is range-partitioned by `created_at` (monthly) in Postgres — see
// packages/db/migrations/0001_partitioned_posts.sql, which owns the physical
// DDL by hand because drizzle-kit's DSL doesn't express `PARTITION BY`. This
// definition is the typed query surface; the composite primary key mirrors
// what partitioning requires (the partition key must be part of every unique
// constraint).
export const posts = pgTable(
  'posts',
  {
    id: bigint('id', { mode: 'bigint' }).notNull(),
    authorId: bigint('author_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id),
    kind: postKind('kind').notNull().default('original'),
    text: varchar('text', { length: 280 }),
    lang: varchar('lang', { length: 8 }),
    inReplyToId: bigint('in_reply_to_id', { mode: 'bigint' }),
    conversationId: bigint('conversation_id', { mode: 'bigint' }),
    repostOfId: bigint('repost_of_id', { mode: 'bigint' }),
    quotedPostId: bigint('quoted_post_id', { mode: 'bigint' }),
    // 0 everyone, 1 followed only, 2 mentioned only — see SPECS.md §4.2.
    replyPolicy: smallint('reply_policy').notNull().default(0),
    isSensitive: boolean('is_sensitive').notNull().default(false),
    clientName: varchar('client_name', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.createdAt] }),
    index('idx_posts_author').on(table.authorId, table.createdAt.desc()),
    // Partial index: thread resolution only ever queries replies.
    index('idx_posts_conversation')
      .on(table.conversationId, table.createdAt)
      .where(sql`${table.kind} = 'reply'`),
    index('idx_posts_quoted').on(table.quotedPostId).where(sql`${table.quotedPostId} is not null`),
  ],
)

export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert

export const postCounters = pgTable('post_counters', {
  postId: bigint('post_id', { mode: 'bigint' }).primaryKey(),
  likesCount: integer('likes_count').notNull().default(0),
  repostsCount: integer('reposts_count').notNull().default(0),
  repliesCount: integer('replies_count').notNull().default(0),
  quotesCount: integer('quotes_count').notNull().default(0),
  bookmarkCount: integer('bookmark_count').notNull().default(0),
  // Synced from ClickHouse in phase 3 (SPECS.md §4.2) — bigint from day one
  // since view counts outgrow a 32-bit integer fast on a viral post.
  // Default is a SQL literal, not a JS `0n`: drizzle-kit's snapshot differ
  // can't JSON-serialize a BigInt default value.
  viewsCount: bigint('views_count', { mode: 'bigint' }).notNull().default(sql`0`),
})

export type PostCounters = typeof postCounters.$inferSelect
export type NewPostCounters = typeof postCounters.$inferInsert

// Entity kind: 0 mention, 1 hashtag, 2 url, 3 cashtag (SPECS.md §4.2).
export const postEntities = pgTable(
  'post_entities',
  {
    postId: bigint('post_id', { mode: 'bigint' }).notNull(),
    kind: smallint('kind').notNull(),
    // Normalized (lowercase for hashtags).
    value: varchar('value', { length: 300 }).notNull(),
    // Code point offsets, not UTF-16 units or bytes — CODESTYLE.md §3.
    startIndex: smallint('start_index').notNull(),
    endIndex: smallint('end_index').notNull(),
    refId: bigint('ref_id', { mode: 'bigint' }),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.startIndex] }),
    index('idx_entities_value').on(table.kind, table.value, table.postId.desc()),
  ],
)

export type PostEntity = typeof postEntities.$inferSelect
