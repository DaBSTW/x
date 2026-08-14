import type { ModerationAction, ModerationAppeal, Report } from '@x/db'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, generateId } from '@x/utils'
import type { NotificationJobData } from '@x/utils'
import type { Mailer } from '../../lib/mailer.js'
import { computeTrustScore } from '../../lib/trust-score.js'
import type { ModerationRepository } from './moderation.repository.js'

type PublishNotification = (data: NotificationJobData) => Promise<void>

export type ModerationServiceDeps = {
  repository: ModerationRepository
  mailer: Pick<Mailer, 'sendModerationActionEmail'>
  /** Optional, same reasoning as posts.service.ts's own onPostCreated/publishNotification: production always wires one, tests that don't care about notifications simply omit it. */
  publishNotification?: PublishNotification
  webUrl: string
}

export type ApplyModerationActionInput = {
  targetType: 'post' | 'user'
  targetId: bigint
  action: 'label' | 'reduce_reach' | 'hide' | 'delete' | 'read_only' | 'suspend' | 'ban'
  reason: string
  policy: string
  actorType: 'system' | 'moderator'
  actorId: bigint | null
  reportId?: bigint
  durationHours?: number
}

export type ModerationService = ReturnType<typeof createModerationService>

const POST_ACTIONS = new Set(['label', 'reduce_reach', 'hide', 'delete'])
const USER_ACTIONS = new Set(['read_only', 'suspend', 'ban'])
const READ_ONLY_MIN_HOURS = 12
const READ_ONLY_MAX_HOURS = 24 * 7

// SPECS.md §12.1's reactive-layer priority: reporter reputation × content
// reach × category severity. No engagement-count lookup here (would mean
// this module depending on posts.repository.ts for one number) — a fixed
// per-category weight is this checkpoint's own honest stand-in for
// "alcance", the same kind of simplification 2.7's PhotoDNA/SHA-256 stood
// in for a real ML pipeline.
const CATEGORY_SEVERITY: Record<string, number> = {
  self_harm: 100,
  violence: 90,
  hate_speech: 80,
  harassment: 70,
  nsfw: 50,
  misinformation: 40,
  spam: 20,
  other: 10,
}
// A reporter with a longer history of *actioned* reports (not just any
// report) is weighted up; nothing below 0 — a noisy reporter's reports
// still queue, just later.
const REPUTATION_LOOKBACK_DAYS = 90

export function createModerationService(deps: ModerationServiceDeps) {
  const { repository, mailer, publishNotification, webUrl } = deps

  function toReportDto(row: Report) {
    return {
      id: row.id.toString(),
      // null for a report the automatic classifier layer generated
      // (ROADMAP.md 3.3d) — no human reporter to attribute it to.
      reporterId: row.reporterId?.toString() ?? null,
      targetType: row.targetType,
      targetId: row.targetId.toString(),
      category: row.category,
      reason: row.reason,
      status: row.status,
      priority: row.priority,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    }
  }

  function toActionDto(row: ModerationAction) {
    return {
      id: row.id.toString(),
      targetType: row.targetType,
      targetId: row.targetId.toString(),
      action: row.action,
      reason: row.reason,
      policy: row.policy,
      actorType: row.actorType,
      actorId: row.actorId?.toString() ?? null,
      reportId: row.reportId?.toString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }
  }

  function toAppealDto(row: ModerationAppeal) {
    return {
      id: row.id.toString(),
      moderationActionId: row.moderationActionId.toString(),
      userId: row.userId.toString(),
      status: row.status,
      userStatement: row.userStatement,
      resolvedBy: row.resolvedBy?.toString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }
  }

  /**
   * Fires both the in-app `system` notification and the richer email
   * SPECS.md §12.2 asks for ("con el fragmento infractor y un enlace para
   * apelar") — the terse notification event has nowhere to carry an
   * excerpt, the email does. The two are independent channels, each
   * wrapped in its own try/catch rather than one covering both: an
   * unreachable Kafka broker failing the in-app publish must never also
   * skip the email (they don't share a failure mode, so they shouldn't
   * share a catch — found by this file's own integration test, which
   * pointed at a real, unreachable-by-design broker and caught the email
   * silently never sending because the publish above it threw first).
   */
  async function notifyTarget(
    context: { notifyUserId: bigint; email: string; fragment: string | null },
    input: ApplyModerationActionInput,
    actionId: bigint,
  ): Promise<void> {
    if (publishNotification) {
      try {
        await publishNotification({
          userId: context.notifyUserId.toString(),
          kind: 'system',
          actorId: null,
          postId: input.targetType === 'post' ? input.targetId.toString() : null,
          groupKey: `moderation:${actionId.toString()}`,
        })
      } catch {
        // Swallowed intentionally — same posture as posts.service.ts's own safePublish.
      }
    }
    const appealUrl = `${webUrl}/moderation/actions/${actionId.toString()}/appeal`
    try {
      await mailer.sendModerationActionEmail(context.email, {
        action: input.action,
        reason: input.reason,
        fragment: context.fragment,
        appealUrl,
      })
    } catch {
      // Swallowed intentionally — mailer.ts's own send() already logs and
      // never throws in practice, this is only a safety net.
    }
  }

  return {
    /** POST /reports — SPECS.md §12.1. */
    async createReport(
      reporterId: bigint,
      input: { targetType: 'post' | 'user'; targetId: bigint; category: string; reason?: string },
    ) {
      const target = await repository.findModerationTargetContext(input.targetType, input.targetId)
      if (!target) throw new NotFoundError(input.targetType, input.targetId.toString())
      if (input.targetType === 'user' && target.notifyUserId === reporterId) {
        throw new ValidationError('cannot report your own account')
      }

      const since = new Date(Date.now() - REPUTATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
      const recentReportCount = await repository.countReportsByReporterSince(reporterId, since)
      // A brand-new reporter (no history either way) starts at the
      // category's own severity, neither boosted nor penalized — only a
      // reporter with an actual track record moves the number.
      const reputationBonus = Math.min(recentReportCount, 20)
      const severity = CATEGORY_SEVERITY[input.category] ?? CATEGORY_SEVERITY.other
      const priority = (severity ?? 10) + reputationBonus

      const id = generateId()
      await repository.insertReport({
        id,
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        category: input.category as Report['category'],
        reason: input.reason ?? null,
        priority,
      })
      return toReportDto({
        id,
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        category: input.category as Report['category'],
        reason: input.reason ?? null,
        status: 'pending',
        priority,
        createdAt: new Date(),
        resolvedAt: null,
        resolvedBy: null,
      })
    },

    async listReportsQueue(status: 'pending' | 'reviewing', limit: number) {
      const rows = await repository.listReportsQueue(status, limit)
      return rows.map(toReportDto)
    },

    /**
     * ROADMAP.md 3.3d's automatic classifier layer, SPECS.md §12.1's
     * "0.70–0.95 → cola de revisión humana priorizada" — reuses the same
     * `reports` queue human-submitted ones go through (reporterId `null`
     * marks it as system-generated) rather than a parallel structure, so
     * apps/admin's review queue is one list, not two. Priority comes
     * directly from the classifier's own score (already a 0–1 confidence
     * number, a more precise signal than createReport's category-severity
     * heuristic above, which exists for the *absence* of a real score).
     */
    async flagForReview(input: {
      targetType: 'post' | 'user'
      targetId: bigint
      category: string
      reason: string
      score: number
    }) {
      const target = await repository.findModerationTargetContext(input.targetType, input.targetId)
      if (!target) throw new NotFoundError(input.targetType, input.targetId.toString())

      const id = generateId()
      const priority = Math.round(input.score * 100)
      await repository.insertReport({
        id,
        reporterId: null,
        targetType: input.targetType,
        targetId: input.targetId,
        category: input.category as Report['category'],
        reason: input.reason,
        priority,
      })
      return toReportDto({
        id,
        reporterId: null,
        targetType: input.targetType,
        targetId: input.targetId,
        category: input.category as Report['category'],
        reason: input.reason,
        status: 'pending',
        priority,
        createdAt: new Date(),
        resolvedAt: null,
        resolvedBy: null,
      })
    },

    /**
     * The graduated-action engine (SPECS.md §12.2) — every one of "etiqueta
     * → reducción de alcance → ocultación → eliminación → modo lectura →
     * suspensión → baneo" goes through this single function, whether it
     * came from a moderator's click in apps/admin or the automatic
     * classifier layer (ROADMAP.md 3.3d) calling it directly in-process.
     */
    async applyModerationAction(input: ApplyModerationActionInput) {
      if (input.targetType === 'post' && !POST_ACTIONS.has(input.action)) {
        throw new ValidationError(`action "${input.action}" only applies to a user target`)
      }
      if (input.targetType === 'user' && !USER_ACTIONS.has(input.action)) {
        throw new ValidationError(`action "${input.action}" only applies to a post target`)
      }

      let expiresAt: Date | null = null
      if (input.action === 'read_only') {
        const hours = input.durationHours
        if (!hours || hours < READ_ONLY_MIN_HOURS || hours > READ_ONLY_MAX_HOURS) {
          throw new ValidationError(
            `read_only requires durationHours between ${READ_ONLY_MIN_HOURS} and ${READ_ONLY_MAX_HOURS}`,
          )
        }
        expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)
      }

      const context = await repository.findModerationTargetContext(input.targetType, input.targetId)
      if (!context) throw new NotFoundError(input.targetType, input.targetId.toString())

      switch (input.action) {
        case 'label':
          await repository.setPostModerationState(input.targetId, { moderatorLabel: input.reason })
          break
        case 'reduce_reach':
          await repository.setPostModerationState(input.targetId, { reducedReach: true })
          break
        case 'hide':
          await repository.setPostModerationState(input.targetId, { moderatorHiddenAt: new Date() })
          break
        case 'delete':
          await repository.softDeletePostByModerator(input.targetId, context.notifyUserId)
          break
        case 'read_only':
          await repository.setUserModerationState(input.targetId, { readOnlyUntil: expiresAt })
          break
        case 'suspend':
          await repository.setUserModerationState(input.targetId, { isSuspended: true })
          break
        case 'ban':
          // A ban implies suspended too — every check downstream (auth
          // login/refresh) only ever needs to test isSuspended/isBanned
          // together, never a ban that's somehow not also a suspension.
          await repository.setUserModerationState(input.targetId, {
            isSuspended: true,
            isBanned: true,
          })
          break
      }

      const id = generateId()
      await repository.insertModerationAction({
        id,
        targetType: input.targetType,
        targetId: input.targetId,
        action: input.action,
        reason: input.reason,
        policy: input.policy,
        actorType: input.actorType,
        actorId: input.actorId,
        reportId: input.reportId ?? null,
        expiresAt,
      })

      if (input.reportId) {
        await repository.markReportStatus(input.reportId, 'actioned', input.actorId ?? undefined)
      }

      // Best-effort — SPECS.md §12.2 requires the action to have happened
      // (already true above); telling the user about it is secondary, same
      // posture as posts.service.ts's onPostCreated/publishNotification.
      try {
        await notifyTarget(context, input, id)
      } catch {
        // Swallowed intentionally.
      }

      return toActionDto({
        id,
        targetType: input.targetType,
        targetId: input.targetId,
        action: input.action,
        reason: input.reason,
        policy: input.policy,
        actorType: input.actorType,
        actorId: input.actorId,
        reportId: input.reportId ?? null,
        expiresAt,
        createdAt: new Date(),
      })
    },

    async listActionsForTarget(targetType: 'post' | 'user', targetId: bigint) {
      const rows = await repository.listModerationActionsForTarget(targetType, targetId)
      return rows.map(toActionDto)
    },

    async listActionsHistory(limit: number) {
      const rows = await repository.listModerationActionsHistory(limit)
      return rows.map(toActionDto)
    },

    /** POST /moderation/actions/:id/appeal — SPECS.md §12.2's "apelable". */
    async createAppeal(userId: bigint, moderationActionId: bigint, userStatement?: string) {
      const action = await repository.findModerationActionById(moderationActionId)
      if (!action) throw new NotFoundError('moderationAction', moderationActionId.toString())

      const context = await repository.findModerationTargetContext(
        action.targetType,
        action.targetId,
      )
      if (!context || context.notifyUserId !== userId) {
        throw new ForbiddenError('only the affected account can appeal this action')
      }

      const existing = await repository.findAppealByActionId(moderationActionId)
      if (existing) {
        throw new ConflictError('this action has already been appealed')
      }

      const id = generateId()
      await repository.insertAppeal({
        id,
        moderationActionId,
        userId,
        userStatement: userStatement ?? null,
      })
      return toAppealDto({
        id,
        moderationActionId,
        userId,
        status: 'pending',
        userStatement: userStatement ?? null,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: new Date(),
      })
    },

    async listAppealsQueue(limit: number) {
      const rows = await repository.listAppealsQueue(limit)
      return rows.map(toAppealDto)
    },

    /** PUT /moderation/appeals/:id — a moderator's decision. Overturning doesn't yet auto-reverse the original action's state change (e.g. un-hide a hidden post) — see ROADMAP.md 3.3's own note on this being follow-up work, not silently assumed done. */
    async resolveAppeal(appealId: bigint, status: 'upheld' | 'overturned', resolvedBy: bigint) {
      const appeal = await repository.findAppealById(appealId)
      if (!appeal) throw new NotFoundError('moderationAppeal', appealId.toString())
      if (appeal.status !== 'pending') {
        throw new ConflictError('this appeal was already resolved')
      }
      await repository.resolveAppeal(appealId, status, resolvedBy)
      return toAppealDto({ ...appeal, status, resolvedBy, resolvedAt: new Date() })
    },

    async isModerator(userId: bigint): Promise<boolean> {
      return repository.findIsModerator(userId)
    },

    /** ROADMAP.md 3.3e — moderator-only (apps/admin's own account-review view is the intended reader). */
    async getTrustScore(userId: bigint): Promise<{ score: number }> {
      const facts = await repository.findTrustScoreFacts(userId)
      if (!facts) throw new NotFoundError('user', userId.toString())
      return { score: computeTrustScore(facts) }
    },
  }
}
