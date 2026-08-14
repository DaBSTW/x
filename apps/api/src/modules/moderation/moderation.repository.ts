import type { Database } from '@x/db'
import {
  type NewModerationAction,
  type NewModerationAppeal,
  type NewReport,
  moderationActions,
  moderationAppeals,
  posts,
  reports,
  userCounters,
  users,
} from '@x/db'
import { and, desc, eq, gte, sql } from 'drizzle-orm'

export type PostModerationStateUpdate = {
  moderatorLabel?: string | null
  reducedReach?: boolean
  moderatorHiddenAt?: Date | null
}

export type UserModerationStateUpdate = {
  isSuspended?: boolean
  isBanned?: boolean
  readOnlyUntil?: Date | null
}

export type ModerationRepository = ReturnType<typeof createModerationRepository>

export function createModerationRepository(db: Database) {
  return {
    // ── Reports (SPECS.md §12.1's reactive layer) ──────────────────────
    async insertReport(data: NewReport): Promise<void> {
      await db.insert(reports).values(data)
    },

    async findReportById(id: bigint) {
      const [row] = await db.select().from(reports).where(eq(reports.id, id)).limit(1)
      return row ?? null
    },

    /** Highest priority first, oldest-first as the tiebreak within a priority band — apps/admin's review queue. */
    async listReportsQueue(status: 'pending' | 'reviewing', limit: number) {
      return db
        .select()
        .from(reports)
        .where(eq(reports.status, status))
        .orderBy(desc(reports.priority), reports.createdAt)
        .limit(limit)
    },

    /** Feeds reporter-reputation scoring (ROADMAP.md 3.3's own wording) — a reporter with a history of dismissed reports weighs less than one whose reports keep getting actioned. */
    async countReportsByReporterSince(reporterId: bigint, since: Date): Promise<number> {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(reports)
        .where(and(eq(reports.reporterId, reporterId), gte(reports.createdAt, since)))
      return row?.count ?? 0
    },

    async markReportStatus(
      id: bigint,
      status: 'reviewing' | 'actioned' | 'dismissed',
      resolvedBy?: bigint,
    ): Promise<void> {
      await db
        .update(reports)
        .set({
          status,
          ...(status !== 'reviewing' && { resolvedAt: new Date(), resolvedBy: resolvedBy ?? null }),
        })
        .where(eq(reports.id, id))
    },

    // ── Moderation actions — insert and select only, never update/delete
    // (packages/db/src/schema/moderation.ts's own immutability comment). ──
    async insertModerationAction(data: NewModerationAction): Promise<void> {
      await db.insert(moderationActions).values(data)
    },

    async findModerationActionById(id: bigint) {
      const [row] = await db
        .select()
        .from(moderationActions)
        .where(eq(moderationActions.id, id))
        .limit(1)
      return row ?? null
    },

    async listModerationActionsForTarget(targetType: 'post' | 'user', targetId: bigint) {
      return db
        .select()
        .from(moderationActions)
        .where(
          and(
            eq(moderationActions.targetType, targetType),
            eq(moderationActions.targetId, targetId),
          ),
        )
        .orderBy(desc(moderationActions.createdAt))
    },

    /** apps/admin's global history feed. */
    async listModerationActionsHistory(limit: number) {
      return db
        .select()
        .from(moderationActions)
        .orderBy(desc(moderationActions.createdAt))
        .limit(limit)
    },

    // ── Content/account state — what actually enforces an action. Kept
    // separate from the log insert above so applyModerationAction can wrap
    // both in one transaction (SPECS.md §12.2 never says the two can
    // disagree, and letting them would mean an action "happened" without
    // ever taking effect, or the reverse). ──
    async setPostModerationState(postId: bigint, update: PostModerationStateUpdate): Promise<void> {
      await db.update(posts).set(update).where(eq(posts.id, postId))
    },

    /** Distinct from posts.service.ts's own softDeletePost: no author-match check — a moderator can delete anyone's post. */
    async softDeletePostByModerator(postId: bigint, authorId: bigint): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId))
        await tx
          .update(userCounters)
          .set({ postsCount: sql`greatest(${userCounters.postsCount} - 1, 0)` })
          .where(eq(userCounters.userId, authorId))
      })
    },

    async setUserModerationState(userId: bigint, update: UserModerationStateUpdate): Promise<void> {
      await db.update(users).set(update).where(eq(users.id, userId))
    },

    /** Resolves a target into who should be notified and what the "infringing fragment" (SPECS.md §12.2) is — a post's own text for a post target, null for a user target (nothing to quote). */
    async findModerationTargetContext(targetType: 'post' | 'user', targetId: bigint) {
      if (targetType === 'user') {
        const [row] = await db
          .select({ id: users.id, email: users.email, username: users.username })
          .from(users)
          .where(eq(users.id, targetId))
          .limit(1)
        return row
          ? { notifyUserId: row.id, email: row.email, fragment: null as string | null }
          : null
      }
      const [row] = await db
        .select({
          authorId: posts.authorId,
          text: posts.text,
          email: users.email,
        })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.authorId))
        .where(eq(posts.id, targetId))
        .limit(1)
      return row ? { notifyUserId: row.authorId, email: row.email, fragment: row.text } : null
    },

    // ── Appeals ──────────────────────────────────────────────────────
    async insertAppeal(data: NewModerationAppeal): Promise<void> {
      await db.insert(moderationAppeals).values(data)
    },

    async findAppealById(id: bigint) {
      const [row] = await db
        .select()
        .from(moderationAppeals)
        .where(eq(moderationAppeals.id, id))
        .limit(1)
      return row ?? null
    },

    /** Enforces "one appeal per action" (packages/db/src/schema/moderation.ts's own uq_moderation_appeals_action) with a friendlier error than a raw constraint violation. */
    async findAppealByActionId(actionId: bigint) {
      const [row] = await db
        .select()
        .from(moderationAppeals)
        .where(eq(moderationAppeals.moderationActionId, actionId))
        .limit(1)
      return row ?? null
    },

    async listAppealsQueue(limit: number) {
      return db
        .select()
        .from(moderationAppeals)
        .where(eq(moderationAppeals.status, 'pending'))
        .orderBy(moderationAppeals.createdAt)
        .limit(limit)
    },

    async resolveAppeal(
      id: bigint,
      status: 'upheld' | 'overturned',
      resolvedBy: bigint,
    ): Promise<void> {
      await db
        .update(moderationAppeals)
        .set({ status, resolvedBy, resolvedAt: new Date() })
        .where(eq(moderationAppeals.id, id))
    },

    async findIsModerator(userId: bigint): Promise<boolean> {
      const [row] = await db
        .select({ isModerator: users.isModerator })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
      return row?.isModerator ?? false
    },
  }
}
