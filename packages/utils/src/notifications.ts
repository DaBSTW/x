// Shared between apps/api (producer) and apps/workers (consumer), same
// reason queues.ts and timeline-constants.ts are shared — SPECS.md §3.

export const NOTIFICATIONS_QUEUE_NAME = 'notifications'

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
