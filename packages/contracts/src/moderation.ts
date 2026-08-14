import { z } from 'zod'
import { paginatedResponseSchema, snowflakeIdSchema } from './common.js'

// Mirrors packages/db/src/schema/moderation.ts's enums — kept in sync by
// hand, same as every other *Schema next to a pgEnum in this package
// (notificationKindSchema/notificationChannelSchema are the precedent).
export const moderationTargetTypeSchema = z.enum(['post', 'user'])
export type ModerationTargetType = z.infer<typeof moderationTargetTypeSchema>

export const reportCategorySchema = z.enum([
  'spam',
  'harassment',
  'hate_speech',
  'violence',
  'nsfw',
  'misinformation',
  'self_harm',
  'other',
])
export type ReportCategory = z.infer<typeof reportCategorySchema>

export const reportStatusSchema = z.enum(['pending', 'reviewing', 'actioned', 'dismissed'])

export const moderationActionTypeSchema = z.enum([
  'label',
  'reduce_reach',
  'hide',
  'delete',
  'read_only',
  'suspend',
  'ban',
])
export type ModerationActionType = z.infer<typeof moderationActionTypeSchema>

export const moderationActorTypeSchema = z.enum(['system', 'moderator'])

export const moderationAppealStatusSchema = z.enum(['pending', 'upheld', 'overturned'])

// POST /reports — SPECS.md §12.1's reactive layer.
export const createReportRequestSchema = z.object({
  targetType: moderationTargetTypeSchema,
  targetId: snowflakeIdSchema,
  category: reportCategorySchema,
  reason: z.string().max(500).optional(),
})
export type CreateReportRequest = z.infer<typeof createReportRequestSchema>

export const reportSchema = z.object({
  id: snowflakeIdSchema,
  reporterId: snowflakeIdSchema,
  targetType: moderationTargetTypeSchema,
  targetId: snowflakeIdSchema,
  category: reportCategorySchema,
  reason: z.string().nullable(),
  status: reportStatusSchema,
  priority: z.number().int(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
})
export type Report = z.infer<typeof reportSchema>

export const reportListResponseSchema = paginatedResponseSchema(reportSchema)

// apps/admin's review queue and history — moderator-only (routes.ts gates
// on isModerator, same 403-not-404 posture as every other authz check in
// this codebase).
export const moderationActionSchema = z.object({
  id: snowflakeIdSchema,
  targetType: moderationTargetTypeSchema,
  targetId: snowflakeIdSchema,
  action: moderationActionTypeSchema,
  reason: z.string(),
  policy: z.string(),
  actorType: moderationActorTypeSchema,
  actorId: snowflakeIdSchema.nullable(),
  reportId: snowflakeIdSchema.nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type ModerationAction = z.infer<typeof moderationActionSchema>

export const moderationActionListResponseSchema = paginatedResponseSchema(moderationActionSchema)

// POST /moderation/actions — a moderator applying a graduated action by
// hand (the automatic classifier layer, ROADMAP.md 3.3d, calls the same
// service function directly, never over HTTP, so it needs no schema here).
export const applyModerationActionRequestSchema = z.object({
  targetType: moderationTargetTypeSchema,
  targetId: snowflakeIdSchema,
  action: moderationActionTypeSchema,
  reason: z.string().min(1).max(500),
  policy: z.string().min(1).max(100),
  reportId: snowflakeIdSchema.optional(),
  // Only meaningful (and required) for `action: 'read_only'` — SPECS.md
  // §12.2's 12h–7d range. Validated against that range in the service, not
  // here, so the 422 comes back as ValidationError like every other
  // business-rule check in this codebase, not a raw Zod issue.
  durationHours: z.number().int().positive().optional(),
})
export type ApplyModerationActionRequest = z.infer<typeof applyModerationActionRequestSchema>

// POST /moderation/actions/:id/appeal
export const createAppealRequestSchema = z.object({
  userStatement: z.string().max(1000).optional(),
})
export type CreateAppealRequest = z.infer<typeof createAppealRequestSchema>

export const moderationAppealSchema = z.object({
  id: snowflakeIdSchema,
  moderationActionId: snowflakeIdSchema,
  userId: snowflakeIdSchema,
  status: moderationAppealStatusSchema,
  userStatement: z.string().nullable(),
  resolvedBy: snowflakeIdSchema.nullable(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type ModerationAppeal = z.infer<typeof moderationAppealSchema>

// PUT /moderation/appeals/:id — a moderator resolving one.
export const resolveAppealRequestSchema = z.object({
  status: z.enum(['upheld', 'overturned']),
})
export type ResolveAppealRequest = z.infer<typeof resolveAppealRequestSchema>
