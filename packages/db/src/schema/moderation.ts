import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users.js'

// SPECS.md §12: today's two reportable entity kinds. A DM message isn't
// reportable yet — conversations.ts has no moderation hook at all, and
// SPECS.md §12 never names messages as a target, only "contenido" broadly.
export const moderationTargetType = pgEnum('moderation_target_type', ['post', 'user'])

// A concrete, real-world set (matches what SPECS.md §12.1 calls "categoría")
// — SPECS.md itself never enumerates one, so this is this checkpoint's own
// call, not read from the spec.
export const reportCategory = pgEnum('report_category', [
  'spam',
  'harassment',
  'hate_speech',
  'violence',
  'nsfw',
  'misinformation',
  'self_harm',
  'other',
])

export const reportStatus = pgEnum('report_status', [
  'pending',
  'reviewing',
  'actioned',
  'dismissed',
])

// SPECS.md §12.2's graduated-action table, in the same order.
export const moderationActionType = pgEnum('moderation_action_type', [
  'label',
  'reduce_reach',
  'hide',
  'delete',
  'read_only',
  'suspend',
  'ban',
])

// Whether a `moderation_actions` row came from a human moderator or the
// automatic classifier layer (SPECS.md §12.1's ">0.95 → acción automática").
export const moderationActorType = pgEnum('moderation_actor_type', ['system', 'moderator'])

export const moderationAppealStatus = pgEnum('moderation_appeal_status', [
  'pending',
  'upheld',
  'overturned',
])

/** SPECS.md §12.1's reactive layer — one row per report, not deduplicated: the same post reported by five different accounts is five rows (each contributes to priority), not one row with a count. */
export const reports = pgTable(
  'reports',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    // Nullable — ROADMAP.md 3.3d's automatic classifier layer inserts a
    // row here too (SPECS.md §12.1's "0.70–0.95 → cola de revisión
    // humana"), reusing this same queue instead of a parallel one, with no
    // human reporter to attribute it to. `null` means system-generated.
    reporterId: bigint('reporter_id', { mode: 'bigint' }).references(() => users.id, {
      onDelete: 'cascade',
    }),
    targetType: moderationTargetType('target_type').notNull(),
    // No FK: the target is either `users.id` or a partitioned `posts.id`
    // (which, like likes.postId/bookmarks.postId, can't be an FK target).
    targetId: bigint('target_id', { mode: 'bigint' }).notNull(),
    category: reportCategory('category').notNull(),
    reason: varchar('reason', { length: 500 }),
    status: reportStatus('status').notNull().default('pending'),
    // Higher sorts first in the review queue — reports.service.ts computes
    // this at insert time from reporter reputation × content reach ×
    // category severity (ROADMAP.md 3.3's own wording), not left for the
    // admin UI to re-derive per render.
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: bigint('resolved_by', { mode: 'bigint' }).references(() => users.id),
  },
  (table) => [
    // The review queue's own primary read: pending reports, most urgent first.
    index('idx_reports_queue').on(table.status, table.priority.desc(), table.createdAt),
    index('idx_reports_target').on(table.targetType, table.targetId),
    // Per-reporter rate limiting / "did I already report this" checks.
    index('idx_reports_reporter').on(table.reporterId, table.createdAt.desc()),
  ],
)

export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert

/**
 * SPECS.md §12.2: "Toda acción genera una entrada en `moderation_actions`
 * con motivo, política aplicada y actor" — immutable by construction, not
 * just by convention: moderation.repository.ts exposes no update or delete
 * for this table, only insert and select. A correction is a *new* row
 * (e.g. an appeal being upheld logs its own entry), never an edit of one
 * that already happened.
 */
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    targetType: moderationTargetType('target_type').notNull(),
    targetId: bigint('target_id', { mode: 'bigint' }).notNull(),
    action: moderationActionType('action').notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    // Free text identifying which rule/classifier/report category drove
    // this — "spam", "harassment", a classifier name — not a foreign key
    // into anything, SPECS.md doesn't model policies as their own entity.
    policy: varchar('policy', { length: 100 }).notNull(),
    actorType: moderationActorType('actor_type').notNull(),
    // NULL for actorType = 'system' (the automatic layer, ROADMAP.md 3.3d)
    // — nothing to attribute to a human.
    actorId: bigint('actor_id', { mode: 'bigint' }).references(() => users.id),
    reportId: bigint('report_id', { mode: 'bigint' }).references(() => reports.id),
    // SPECS.md §12.2's "Modo lectura" is time-bounded (12h–7d); every other
    // action is indefinite (until a future action reverses it) — null here.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // "Every action ever taken against this target" — moderation history
    // for a specific post/account, apps/admin's account-search detail view.
    index('idx_moderation_actions_target').on(
      table.targetType,
      table.targetId,
      table.createdAt.desc(),
    ),
    // apps/admin's global history feed, newest first.
    index('idx_moderation_actions_created').on(table.createdAt.desc()),
  ],
)

export type ModerationAction = typeof moderationActions.$inferSelect
export type NewModerationAction = typeof moderationActions.$inferInsert

/**
 * SPECS.md §12.2: every action is "apelable" (ban explicitly "una vez").
 * Modeled as exactly one appeal per `moderation_actions` row (the `unique`
 * below) for every action type, the simplest reading that's still
 * consistent with ban's explicit "once" — this checkpoint's own call where
 * SPECS.md doesn't fully disambiguate the other rows.
 */
export const moderationAppeals = pgTable(
  'moderation_appeals',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    moderationActionId: bigint('moderation_action_id', { mode: 'bigint' })
      .notNull()
      .references(() => moderationActions.id),
    userId: bigint('user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: moderationAppealStatus('status').notNull().default('pending'),
    userStatement: varchar('user_statement', { length: 1000 }),
    resolvedBy: bigint('resolved_by', { mode: 'bigint' }).references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_moderation_appeals_action').on(table.moderationActionId),
    index('idx_moderation_appeals_status').on(table.status, table.createdAt),
    index('idx_moderation_appeals_user').on(table.userId, table.createdAt.desc()),
  ],
)

export type ModerationAppeal = typeof moderationAppeals.$inferSelect
export type NewModerationAppeal = typeof moderationAppeals.$inferInsert
