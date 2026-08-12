import { z } from 'zod'
import { paginatedResponseSchema, snowflakeIdSchema } from './common.js'
import { userProfileSchema } from './user.js'

export const notificationKindSchema = z.enum([
  'like',
  'repost',
  'reply',
  'quote',
  'follow',
  'mention',
  'follow_request',
  'system',
])

export const notificationSchema = z.object({
  id: snowflakeIdSchema,
  kind: notificationKindSchema,
  // `null` for `system` notifications, which have no actor.
  actor: userProfileSchema
    .pick({ id: true, username: true, displayName: true, avatarUrl: true, isVerified: true })
    .nullable(),
  postId: snowflakeIdSchema.nullable(),
  groupKey: z.string().nullable(),
  isRead: z.boolean(),
  createdAt: z.string().datetime(),
})
export type Notification = z.infer<typeof notificationSchema>

export const notificationListResponseSchema = paginatedResponseSchema(notificationSchema)

export const unreadCountResponseSchema = z.object({
  data: z.object({ count: z.number().int().nonnegative() }),
})

export const markNotificationsReadSchema = z.object({ cursor: snowflakeIdSchema })
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>

// ROADMAP.md 2.9 "preferencias granulares por tipo × canal" — 'system' is
// deliberately excluded from notificationKindSchema's list here since it's
// never user-configurable (mirrors why security emails aren't either).
export const notificationChannelSchema = z.enum(['in_app', 'push'])
export const configurableNotificationKindSchema = z.enum([
  'like',
  'repost',
  'reply',
  'quote',
  'follow',
  'mention',
  'follow_request',
])

export const notificationPreferenceSchema = z.object({
  kind: configurableNotificationKindSchema,
  channel: notificationChannelSchema,
  enabled: z.boolean(),
})
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>

export const notificationPreferencesResponseSchema = z.object({
  data: z.array(notificationPreferenceSchema),
})

export const updateNotificationPreferenceRequestSchema = z.object({
  kind: configurableNotificationKindSchema,
  channel: notificationChannelSchema,
  enabled: z.boolean(),
})
export type UpdateNotificationPreferenceRequest = z.infer<
  typeof updateNotificationPreferenceRequestSchema
>
