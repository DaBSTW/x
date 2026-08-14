import { bigint, index, pgEnum, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
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

export const devicePlatform = pgEnum('device_platform', ['fcm', 'apns'])

// ROADMAP.md 2.9's last bullet — FCM/APNs device tokens, prepared ahead of
// the mobile app itself (Phase 4). Deliberately its own table rather than
// widening `pushSubscriptions` above: a device token is a single opaque
// string, not the endpoint+p256dh+authKey triple Web Push needs, and
// cramming both shapes into one table would mean two of three columns are
// always null depending on `platform` — this way neither shape has to make
// room for the other's fields. `token` unique for the same reason
// `endpoint` is: it's how a repeat registration from the same installed
// app is recognized as "already registered" instead of duplicated (Expo's
// `expo-notifications`, the SDK ROADMAP.md 4's React Native app is expected
// to use, hands back the same token across app restarts on the same
// device/install).
export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    userId: bigint('user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: devicePlatform('platform').notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('device_tokens_token_key').on(table.token),
    index('idx_device_tokens_user').on(table.userId),
  ],
)

export type DeviceToken = typeof deviceTokens.$inferSelect
export type NewDeviceToken = typeof deviceTokens.$inferInsert
