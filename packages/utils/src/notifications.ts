// Shared between apps/api (producer) and apps/workers (consumer), same
// reason queues.ts and timeline-constants.ts are shared — SPECS.md §3.
// Kafka since ROADMAP.md 3.1 (kafka-events.ts's INTERACTION_EVENTS_TOPIC) —
// this was BullMQ's queue name before that migration.

export const NOTIFICATION_KINDS = [
  'like',
  'repost',
  'reply',
  'quote',
  'follow',
  'mention',
  'follow_request',
  'system',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

// 'system' excluded — never user-configurable, same reasoning security
// emails aren't (mailer.ts).
export const CONFIGURABLE_NOTIFICATION_KINDS = [
  'like',
  'repost',
  'reply',
  'quote',
  'follow',
  'mention',
  'follow_request',
] as const
export type ConfigurableNotificationKind = (typeof CONFIGURABLE_NOTIFICATION_KINDS)[number]

export const NOTIFICATION_CHANNELS = ['in_app', 'push'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

// SPECS.md §13.2's push "uso" column is "Menciones, DMs, follows" — DMs
// excluded, they're a separate system not wired to `notifications` at all
// (conversations.service.ts). follow_request rides with follow: both are
// "someone wants to connect with you." Shared by apps/api (what the
// preferences endpoint reports before any override) and apps/workers (what
// notifications.worker.ts actually pushes for) — one definition so the two
// can't drift apart.
const DEFAULT_PUSH_ENABLED_KINDS = new Set<ConfigurableNotificationKind>([
  'follow',
  'mention',
  'follow_request',
])

export function defaultChannelEnabled(
  kind: ConfigurableNotificationKind,
  channel: NotificationChannel,
): boolean {
  return channel === 'in_app' ? true : DEFAULT_PUSH_ENABLED_KINDS.has(kind)
}

export type NotificationJobData = {
  /** Recipient. */
  userId: string
  kind: NotificationKind
  /** Who triggered it — `null` for `system` notifications. */
  actorId: string | null
  postId: string | null
  groupKey: string | null
}

/** Redis-cached unread count (SPECS.md §5.4) — seeded from Postgres on a cold miss, adjusted incrementally after that. */
export function unreadCountKey(userId: string | bigint): string {
  return `notifications:unread:${userId}`
}
