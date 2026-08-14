import type { ModerationAction, ModerationAppeal, Report } from '@x/db'
import { generateId } from '@x/utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ModerationActionEmailInput } from '../../lib/mailer.js'
import type {
  ModerationRepository,
  PostModerationStateUpdate,
  UserModerationStateUpdate,
} from './moderation.repository.js'
import { createModerationService } from './moderation.service.js'

type FakeMailer = {
  sent: Array<{ to: string; action: string; reason: string; fragment: string | null }>
  sendModerationActionEmail: (to: string, input: ModerationActionEmailInput) => Promise<void>
}

function createFakeMailer(): FakeMailer {
  const sent: FakeMailer['sent'] = []
  return {
    sent,
    async sendModerationActionEmail(to, input) {
      sent.push({ to, action: input.action, reason: input.reason, fragment: input.fragment })
    },
  }
}

function createFakeRepository() {
  const reports: Report[] = []
  const actions: ModerationAction[] = []
  const appeals: ModerationAppeal[] = []
  const postStates = new Map<
    bigint,
    { authorId: bigint; text: string | null; deletedAt: Date | null } & PostModerationStateUpdate
  >()
  type UserState = {
    email: string
    accountAgeMs: number
    emailVerified: boolean
    followersCount: number
    followingCount: number
  } & UserModerationStateUpdate
  const userStates = new Map<bigint, UserState>()

  const repository: ModerationRepository = {
    async insertReport(data) {
      reports.push({
        ...data,
        status: 'pending',
        createdAt: new Date(),
        resolvedAt: null,
        resolvedBy: null,
      } as Report)
    },
    async findReportById(id) {
      return reports.find((r) => r.id === id) ?? null
    },
    async listReportsQueue(status, limit) {
      return reports
        .filter((r) => r.status === status)
        .sort((a, b) => b.priority - a.priority)
        .slice(0, limit)
    },
    async countReportsByReporterSince(reporterId, since) {
      return reports.filter((r) => r.reporterId === reporterId && r.createdAt >= since).length
    },
    async markReportStatus(id, status, resolvedBy) {
      const report = reports.find((r) => r.id === id)
      if (report) {
        report.status = status
        if (status !== 'reviewing') {
          report.resolvedAt = new Date()
          report.resolvedBy = resolvedBy ?? null
        }
      }
    },
    async insertModerationAction(data) {
      actions.push({ ...data } as ModerationAction)
    },
    async findModerationActionById(id) {
      return actions.find((a) => a.id === id) ?? null
    },
    async listModerationActionsForTarget(targetType, targetId) {
      return actions.filter((a) => a.targetType === targetType && a.targetId === targetId)
    },
    async listModerationActionsHistory(limit) {
      return actions.slice(0, limit)
    },
    async setPostModerationState(postId, update) {
      const post = postStates.get(postId)
      if (post) Object.assign(post, update)
    },
    async softDeletePostByModerator(postId) {
      const post = postStates.get(postId)
      if (post) post.deletedAt = new Date()
    },
    async setUserModerationState(userId, update) {
      const user = userStates.get(userId)
      if (user) Object.assign(user, update)
    },
    async findModerationTargetContext(targetType, targetId) {
      if (targetType === 'user') {
        const user = userStates.get(targetId)
        return user ? { notifyUserId: targetId, email: user.email, fragment: null } : null
      }
      const post = postStates.get(targetId)
      if (!post) return null
      const author = userStates.get(post.authorId)
      if (!author) return null
      return { notifyUserId: post.authorId, email: author.email, fragment: post.text }
    },
    async insertAppeal(data) {
      appeals.push({
        ...data,
        status: 'pending',
        resolvedBy: null,
        resolvedAt: null,
        createdAt: new Date(),
      } as ModerationAppeal)
    },
    async findAppealById(id) {
      return appeals.find((a) => a.id === id) ?? null
    },
    async findAppealByActionId(actionId) {
      return appeals.find((a) => a.moderationActionId === actionId) ?? null
    },
    async listAppealsQueue(limit) {
      return appeals.filter((a) => a.status === 'pending').slice(0, limit)
    },
    async resolveAppeal(id, status, resolvedBy) {
      const appeal = appeals.find((a) => a.id === id)
      if (appeal) {
        appeal.status = status
        appeal.resolvedBy = resolvedBy
        appeal.resolvedAt = new Date()
      }
    },
    async findIsModerator() {
      // Not exercised here — moderation.routes.ts's requireModerator (the
      // only caller) is covered against a real Postgres in
      // moderation.integration.test.ts instead.
      return false
    },
    async findTrustScoreFacts(userId) {
      const user = userStates.get(userId)
      if (!user) return null
      return {
        accountAgeMs: user.accountAgeMs,
        emailVerified: user.emailVerified,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        // Derived live from the same reports/actions arrays every other
        // method here reads and writes — not a separately-tracked count
        // that could drift from what applyModerationAction/createReport
        // actually did.
        reportCount: reports.filter((r) => r.targetType === 'user' && r.targetId === userId).length,
        actionedCount: actions.filter((a) => a.targetType === 'user' && a.targetId === userId)
          .length,
      }
    },
  }

  return {
    repository,
    seedPost(id: bigint, authorId: bigint, text: string | null = 'hola mundo') {
      postStates.set(id, { authorId, text, deletedAt: null })
    },
    seedUser(
      id: bigint,
      email = `user${id}@example.com`,
      extra: Partial<Omit<UserState, 'email'>> = {},
    ) {
      userStates.set(id, {
        email,
        // A mid-of-the-road default (not brand new, not a year old;
        // unverified; a neutral 1:1 ratio) — every existing seedUser call
        // in this file predates trust scoring and doesn't care about
        // these fields, only the tests under describe('getTrustScore')
        // below override them.
        accountAgeMs: 30 * 24 * 60 * 60 * 1000,
        emailVerified: false,
        followersCount: 10,
        followingCount: 10,
        ...extra,
      })
    },
    getPost(id: bigint) {
      return postStates.get(id)
    },
    getUser(id: bigint) {
      return userStates.get(id)
    },
  }
}

describe('createModerationService', () => {
  let fake: ReturnType<typeof createFakeRepository>
  let mailer: ReturnType<typeof createFakeMailer>

  beforeEach(() => {
    fake = createFakeRepository()
    mailer = createFakeMailer()
  })

  function makeService() {
    return createModerationService({
      repository: fake.repository,
      mailer,
      webUrl: 'https://x.example.com',
    })
  }

  describe('createReport', () => {
    it('scores priority from category severity, with a small bonus for an experienced reporter', async () => {
      const reporterId = generateId()
      const authorId = generateId()
      const postId = generateId()
      fake.seedUser(authorId)
      fake.seedPost(postId, authorId)
      const service = makeService()

      const report = await service.createReport(reporterId, {
        targetType: 'post',
        targetId: postId,
        category: 'harassment',
      })

      expect(report.priority).toBe(70) // harassment's own severity, no history yet
      expect(report.status).toBe('pending')
    })

    it('rejects reporting your own account', async () => {
      const userId = generateId()
      fake.seedUser(userId)
      const service = makeService()

      await expect(
        service.createReport(userId, { targetType: 'user', targetId: userId, category: 'spam' }),
      ).rejects.toThrow('cannot report your own account')
    })

    it('throws NotFoundError for a target that does not exist', async () => {
      const service = makeService()
      await expect(
        service.createReport(generateId(), {
          targetType: 'post',
          targetId: generateId(),
          category: 'spam',
        }),
      ).rejects.toThrow(/not found/)
    })
  })

  describe('flagForReview (ROADMAP.md 3.3d)', () => {
    it('inserts a reporterId: null report, with priority taken directly from the classifier score', async () => {
      const authorId = generateId()
      const postId = generateId()
      fake.seedUser(authorId)
      fake.seedPost(postId, authorId)
      const service = makeService()

      const report = await service.flagForReview({
        targetType: 'post',
        targetId: postId,
        category: 'harassment',
        reason: 'flagged automatically by the toxicity classifier (score 0.82)',
        score: 0.82,
      })

      expect(report.reporterId).toBeNull()
      expect(report.priority).toBe(82)
      expect(report.status).toBe('pending')

      const [queued] = await service.listReportsQueue('pending', 10)
      expect(queued?.id).toBe(report.id)
    })

    it('throws NotFoundError for a target that does not exist', async () => {
      const service = makeService()
      await expect(
        service.flagForReview({
          targetType: 'post',
          targetId: generateId(),
          category: 'spam',
          reason: 'x',
          score: 0.8,
        }),
      ).rejects.toThrow(/not found/)
    })
  })

  describe('applyModerationAction', () => {
    it('label sets moderatorLabel on the post and emails the author with the fragment', async () => {
      const authorId = generateId()
      const postId = generateId()
      fake.seedUser(authorId, 'author@example.com')
      fake.seedPost(postId, authorId, 'contenido dudoso')
      const service = makeService()

      const action = await service.applyModerationAction({
        targetType: 'post',
        targetId: postId,
        action: 'label',
        reason: 'contenido sensible',
        policy: 'nsfw',
        actorType: 'moderator',
        actorId: generateId(),
      })

      expect(action.action).toBe('label')
      expect(fake.getPost(postId)?.moderatorLabel).toBe('contenido sensible')
      expect(mailer.sent).toEqual([
        {
          to: 'author@example.com',
          action: 'label',
          reason: 'contenido sensible',
          fragment: 'contenido dudoso',
        },
      ])
    })

    it('reduce_reach flips the flag without touching the post text', async () => {
      const authorId = generateId()
      const postId = generateId()
      fake.seedUser(authorId)
      fake.seedPost(postId, authorId)
      const service = makeService()

      await service.applyModerationAction({
        targetType: 'post',
        targetId: postId,
        action: 'reduce_reach',
        reason: 'spam-like pattern',
        policy: 'spam',
        actorType: 'system',
        actorId: null,
      })

      expect(fake.getPost(postId)?.reducedReach).toBe(true)
    })

    it('hide sets moderatorHiddenAt', async () => {
      const authorId = generateId()
      const postId = generateId()
      fake.seedUser(authorId)
      fake.seedPost(postId, authorId)
      const service = makeService()

      await service.applyModerationAction({
        targetType: 'post',
        targetId: postId,
        action: 'hide',
        reason: 'reported content',
        policy: 'harassment',
        actorType: 'moderator',
        actorId: generateId(),
      })

      expect(fake.getPost(postId)?.moderatorHiddenAt).toBeInstanceOf(Date)
    })

    it('delete soft-deletes the post', async () => {
      const authorId = generateId()
      const postId = generateId()
      fake.seedUser(authorId)
      fake.seedPost(postId, authorId)
      const service = makeService()

      await service.applyModerationAction({
        targetType: 'post',
        targetId: postId,
        action: 'delete',
        reason: 'violates policy',
        policy: 'violence',
        actorType: 'moderator',
        actorId: generateId(),
      })

      expect(fake.getPost(postId)?.deletedAt).toBeInstanceOf(Date)
    })

    it('read_only requires a duration within 12-168 hours and sets readOnlyUntil', async () => {
      const userId = generateId()
      fake.seedUser(userId)
      const service = makeService()

      await expect(
        service.applyModerationAction({
          targetType: 'user',
          targetId: userId,
          action: 'read_only',
          reason: 'repeated spam',
          policy: 'spam',
          actorType: 'moderator',
          actorId: generateId(),
        }),
      ).rejects.toThrow(/durationHours/)

      await expect(
        service.applyModerationAction({
          targetType: 'user',
          targetId: userId,
          action: 'read_only',
          reason: 'repeated spam',
          policy: 'spam',
          actorType: 'moderator',
          actorId: generateId(),
          durationHours: 200,
        }),
      ).rejects.toThrow(/durationHours/)

      const before = Date.now()
      await service.applyModerationAction({
        targetType: 'user',
        targetId: userId,
        action: 'read_only',
        reason: 'repeated spam',
        policy: 'spam',
        actorType: 'moderator',
        actorId: generateId(),
        durationHours: 24,
      })
      const readOnlyUntil = fake.getUser(userId)?.readOnlyUntil
      expect(readOnlyUntil).toBeInstanceOf(Date)
      expect((readOnlyUntil as Date).getTime()).toBeGreaterThan(before + 23 * 60 * 60 * 1000)
    })

    it('suspend sets isSuspended; ban sets both isSuspended and isBanned', async () => {
      const suspendedId = generateId()
      const bannedId = generateId()
      fake.seedUser(suspendedId)
      fake.seedUser(bannedId)
      const service = makeService()

      await service.applyModerationAction({
        targetType: 'user',
        targetId: suspendedId,
        action: 'suspend',
        reason: 'harassment campaign',
        policy: 'harassment',
        actorType: 'moderator',
        actorId: generateId(),
      })
      await service.applyModerationAction({
        targetType: 'user',
        targetId: bannedId,
        action: 'ban',
        reason: 'severe violation',
        policy: 'violence',
        actorType: 'moderator',
        actorId: generateId(),
      })

      expect(fake.getUser(suspendedId)).toMatchObject({ isSuspended: true })
      expect(fake.getUser(suspendedId)?.isBanned).toBeUndefined()
      expect(fake.getUser(bannedId)).toMatchObject({ isSuspended: true, isBanned: true })
    })

    it('rejects a post-only action against a user target, and vice versa', async () => {
      const userId = generateId()
      fake.seedUser(userId)
      const service = makeService()

      await expect(
        service.applyModerationAction({
          targetType: 'user',
          targetId: userId,
          action: 'hide',
          reason: 'x',
          policy: 'x',
          actorType: 'moderator',
          actorId: generateId(),
        }),
      ).rejects.toThrow(/only applies to a post target/)

      const postId = generateId()
      fake.seedPost(postId, userId)
      await expect(
        service.applyModerationAction({
          targetType: 'post',
          targetId: postId,
          action: 'suspend',
          reason: 'x',
          policy: 'x',
          actorType: 'moderator',
          actorId: generateId(),
        }),
      ).rejects.toThrow(/only applies to a user target/)
    })

    it('marks the triggering report as actioned', async () => {
      const authorId = generateId()
      const postId = generateId()
      fake.seedUser(authorId)
      fake.seedPost(postId, authorId)
      const reporterId = generateId()
      const service = makeService()
      const report = await service.createReport(reporterId, {
        targetType: 'post',
        targetId: postId,
        category: 'spam',
      })

      await service.applyModerationAction({
        targetType: 'post',
        targetId: postId,
        action: 'hide',
        reason: 'confirmed spam',
        policy: 'spam',
        actorType: 'moderator',
        actorId: generateId(),
        reportId: BigInt(report.id),
      })

      const [resolved] = await service.listReportsQueue('pending', 10)
      expect(resolved).toBeUndefined() // no longer pending
    })
  })

  describe('createAppeal', () => {
    it('lets the affected author appeal, and rejects a second appeal on the same action', async () => {
      const authorId = generateId()
      const postId = generateId()
      fake.seedUser(authorId)
      fake.seedPost(postId, authorId)
      const service = makeService()
      const action = await service.applyModerationAction({
        targetType: 'post',
        targetId: postId,
        action: 'hide',
        reason: 'reported',
        policy: 'spam',
        actorType: 'moderator',
        actorId: generateId(),
      })

      const appeal = await service.createAppeal(authorId, BigInt(action.id), 'no era spam')
      expect(appeal.status).toBe('pending')
      expect(appeal.userStatement).toBe('no era spam')

      await expect(service.createAppeal(authorId, BigInt(action.id))).rejects.toThrow(
        /already been appealed/,
      )
    })

    it('rejects an appeal from anyone but the affected account', async () => {
      const authorId = generateId()
      const postId = generateId()
      const strangerId = generateId()
      fake.seedUser(authorId)
      fake.seedPost(postId, authorId)
      const service = makeService()
      const action = await service.applyModerationAction({
        targetType: 'post',
        targetId: postId,
        action: 'hide',
        reason: 'reported',
        policy: 'spam',
        actorType: 'moderator',
        actorId: generateId(),
      })

      await expect(service.createAppeal(strangerId, BigInt(action.id))).rejects.toThrow(
        /only the affected account/,
      )
    })
  })

  describe('resolveAppeal', () => {
    it('records the moderator and outcome, and rejects resolving twice', async () => {
      const authorId = generateId()
      const postId = generateId()
      fake.seedUser(authorId)
      fake.seedPost(postId, authorId)
      const service = makeService()
      const action = await service.applyModerationAction({
        targetType: 'post',
        targetId: postId,
        action: 'hide',
        reason: 'reported',
        policy: 'spam',
        actorType: 'moderator',
        actorId: generateId(),
      })
      const appeal = await service.createAppeal(authorId, BigInt(action.id))
      const resolverId = generateId()

      const resolved = await service.resolveAppeal(BigInt(appeal.id), 'overturned', resolverId)
      expect(resolved.status).toBe('overturned')
      expect(resolved.resolvedBy).toBe(resolverId.toString())

      await expect(service.resolveAppeal(BigInt(appeal.id), 'upheld', resolverId)).rejects.toThrow(
        /already resolved/,
      )
    })
  })

  describe('getTrustScore (ROADMAP.md 3.3e)', () => {
    it('scores a mature, verified, well-behaved account higher than a fresh, unverified one', async () => {
      const establishedId = generateId()
      const freshId = generateId()
      fake.seedUser(establishedId, undefined, {
        accountAgeMs: 365 * 24 * 60 * 60 * 1000,
        emailVerified: true,
        followersCount: 200,
        followingCount: 200,
      })
      fake.seedUser(freshId, undefined, { accountAgeMs: 0, emailVerified: false })
      const service = makeService()

      const established = await service.getTrustScore(establishedId)
      const fresh = await service.getTrustScore(freshId)

      expect(established.score).toBeGreaterThan(fresh.score)
    })

    it('reflects real report/action history, not a stored count that could drift', async () => {
      const authorId = generateId()
      const postId = generateId()
      fake.seedUser(authorId)
      fake.seedPost(postId, authorId)
      const service = makeService()
      const before = await service.getTrustScore(authorId)

      await service.applyModerationAction({
        targetType: 'user',
        targetId: authorId,
        action: 'suspend',
        reason: 'harassment campaign',
        policy: 'harassment',
        actorType: 'moderator',
        actorId: generateId(),
      })

      const after = await service.getTrustScore(authorId)
      expect(after.score).toBeLessThan(before.score)
    })

    it('throws NotFoundError for an account that does not exist', async () => {
      const service = makeService()
      await expect(service.getTrustScore(generateId())).rejects.toThrow(/not found/)
    })
  })
})
