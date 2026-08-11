import { bigint, index, pgEnum, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.js'

export const notificationKind = pgEnum('notification_kind', [
  'like',
  'repost',
  'reply',
  'quote',
  'follow',
  'mention',
  'follow_request',
  'system',
])

// Range-partitioned by `created_at` (monthly), same as `posts` — SPECS.md
// §14.1 lists both under "Particionado". Physical DDL is hand-patched in
// packages/db/migrations after `drizzle-kit generate` for the same reason
// posts.ts documents: no `PARTITION BY` in the DSL. The composite primary
// key mirrors what partitioning requires (partition key must be part of
// every unique constraint) — see migrations/0000 for the `posts` precedent.
export const notifications = pgTable(
  'notifications',
  {
    id: bigint('id', { mode: 'bigint' }).notNull(),
    userId: bigint('user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKind('kind').notNull(),
    actorId: bigint('actor_id', { mode: 'bigint' }).references(() => users.id),
    // No FK: `posts` is partitioned, its PK is (id, created_at) — see
    // post_counters/post_entities for the same non-FK precedent.
    postId: bigint('post_id', { mode: 'bigint' }),
    // Groups related events for display (e.g. "Ana y 12 más te dieron
    // like") — SPECS.md §3's comment on this column. Collapsing same-key
    // rows into one visual item is a read-side concern; see ROADMAP.md 1.7
    // for what's implemented today vs. deferred.
    groupKey: text('group_key'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.createdAt] }),
    index('idx_notifications_user').on(table.userId, table.id.desc()),
  ],
)

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
