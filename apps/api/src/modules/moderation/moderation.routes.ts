import {
  applyModerationActionRequestSchema,
  createAppealRequestSchema,
  createReportRequestSchema,
  errorResponseSchema,
  moderationActionListResponseSchema,
  moderationActionSchema,
  moderationAppealSchema,
  paginationQuerySchema,
  reportListResponseSchema,
  reportSchema,
  resolveAppealRequestSchema,
} from '@x/contracts'
import { ForbiddenError } from '@x/utils'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { createRequireAuth, getAuthenticatedUser } from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { ModerationService } from './moderation.service.js'

export type ModerationRoutesOptions = {
  moderationService: ModerationService
  tokenService: TokenService
}

export async function registerModerationRoutes(
  app: FastifyInstance,
  options: ModerationRoutesOptions,
) {
  const { moderationService, tokenService } = options
  const requireAuth = createRequireAuth(tokenService)

  /** Moderator-only routes stack this after requireAuth (mirrors CODESTYLE.md §12's own "no a mano dentro del handler") — 403, not 404: same posture every other authz check in this codebase already takes (e.g. ForbiddenError on "only the author can delete this post"), telling a non-moderator the route exists but is off-limits rather than pretending it doesn't. */
  async function requireModerator(request: FastifyRequest): Promise<void> {
    const user = getAuthenticatedUser(request)
    if (!(await moderationService.isModerator(user.id))) {
      throw new ForbiddenError('moderator access required')
    }
  }

  const server = app.withTypeProvider<ZodTypeProvider>()

  server.post(
    '/reports',
    {
      schema: {
        body: createReportRequestSchema,
        response: { 201: z.object({ data: reportSchema }), 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const report = await moderationService.createReport(user.id, {
        targetType: request.body.targetType,
        targetId: BigInt(request.body.targetId),
        category: request.body.category,
        ...(request.body.reason !== undefined && { reason: request.body.reason }),
      })
      return reply.status(201).send({ data: report })
    },
  )

  server.get(
    '/moderation/reports',
    {
      schema: {
        querystring: paginationQuerySchema.pick({ limit: true }).extend({
          status: z.enum(['pending', 'reviewing']).default('pending'),
        }),
        response: {
          200: z.object({ data: reportListResponseSchema.shape.data }),
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
      preHandler: [requireAuth, requireModerator],
    },
    async (request, reply) => {
      const reportsList = await moderationService.listReportsQueue(
        request.query.status,
        request.query.limit,
      )
      return reply.send({ data: reportsList })
    },
  )

  server.post(
    '/moderation/actions',
    {
      schema: {
        body: applyModerationActionRequestSchema,
        response: {
          201: z.object({ data: moderationActionSchema }),
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
      preHandler: [requireAuth, requireModerator],
    },
    async (request, reply) => {
      const moderator = getAuthenticatedUser(request)
      const action = await moderationService.applyModerationAction({
        targetType: request.body.targetType,
        targetId: BigInt(request.body.targetId),
        action: request.body.action,
        reason: request.body.reason,
        policy: request.body.policy,
        actorType: 'moderator',
        actorId: moderator.id,
        ...(request.body.reportId && { reportId: BigInt(request.body.reportId) }),
        ...(request.body.durationHours !== undefined && {
          durationHours: request.body.durationHours,
        }),
      })
      return reply.status(201).send({ data: action })
    },
  )

  server.get(
    '/moderation/actions',
    {
      schema: {
        querystring: paginationQuerySchema.pick({ limit: true }),
        response: {
          200: z.object({ data: moderationActionListResponseSchema.shape.data }),
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
      preHandler: [requireAuth, requireModerator],
    },
    async (request, reply) => {
      const actions = await moderationService.listActionsHistory(request.query.limit)
      return reply.send({ data: actions })
    },
  )

  server.get(
    '/moderation/targets/:targetType/:targetId/actions',
    {
      schema: {
        params: z.object({ targetType: z.enum(['post', 'user']), targetId: z.string() }),
        response: {
          200: z.object({ data: moderationActionListResponseSchema.shape.data }),
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
      preHandler: [requireAuth, requireModerator],
    },
    async (request, reply) => {
      const actions = await moderationService.listActionsForTarget(
        request.params.targetType,
        BigInt(request.params.targetId),
      )
      return reply.send({ data: actions })
    },
  )

  // Any authenticated user, not moderator-only — moderation.service.ts's
  // createAppeal is what actually checks the caller is the affected
  // account (ForbiddenError otherwise), the same "the route accepts
  // anyone, the service enforces who" split posts.service.ts's remove()
  // already uses for "only the author can delete this post".
  server.post(
    '/moderation/actions/:id/appeal',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: createAppealRequestSchema,
        response: {
          201: z.object({ data: moderationAppealSchema }),
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const appeal = await moderationService.createAppeal(
        user.id,
        BigInt(request.params.id),
        request.body.userStatement,
      )
      return reply.status(201).send({ data: appeal })
    },
  )

  server.get(
    '/moderation/appeals',
    {
      schema: {
        querystring: paginationQuerySchema.pick({ limit: true }),
        response: {
          200: z.object({ data: z.array(moderationAppealSchema) }),
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
      preHandler: [requireAuth, requireModerator],
    },
    async (request, reply) => {
      const appeals = await moderationService.listAppealsQueue(request.query.limit)
      return reply.send({ data: appeals })
    },
  )

  server.put(
    '/moderation/appeals/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: resolveAppealRequestSchema,
        response: {
          200: z.object({ data: moderationAppealSchema }),
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
      preHandler: [requireAuth, requireModerator],
    },
    async (request, reply) => {
      const moderator = getAuthenticatedUser(request)
      const appeal = await moderationService.resolveAppeal(
        BigInt(request.params.id),
        request.body.status,
        moderator.id,
      )
      return reply.send({ data: appeal })
    },
  )
}
