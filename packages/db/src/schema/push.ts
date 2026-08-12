import { bigint, index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { users } from './users.js'

// ROADMAP.md 2.9 — one row per browser subscription (Web Push API). A user
// can have several (one per device/browser); `endpoint` is unique because
// the browser itself guarantees that, and it's how we recognize "this
// device already subscribed" on a repeat POST /push/subscriptions.
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    userId: bigint('user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    authKey: text('auth_key').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('push_subscriptions_endpoint_key').on(table.endpoint),
    index('idx_push_subscriptions_user').on(table.userId),
  ],
)

export type PushSubscription = typeof pushSubscriptions.$inferSelect
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert
