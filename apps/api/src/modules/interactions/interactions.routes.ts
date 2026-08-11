import { errorResponseSchema, postResponseSchema, snowflakeIdSchema } from '@x/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { enforceRateLimit } from '../../lib/rate-limit.js'
import { createRequireAuth, getAuthenticatedUser } from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { InteractionsService } from './interactions.service.js'

// SPECS.md §5.5: POST /posts/:id/like — 1000 requests / 24h per user.
const LIKE_RATE_LIMIT = { limit: 1000, windowMs: 24 * 60 * 60 * 1000 }

export type InteractionsRoutesOptions = {
  interactionsService: InteractionsService
  tokenService: TokenService
}

export async function registerInteractionsRoutes(
  app: FastifyInstance,
  options: InteractionsRoutesOptions,
) {
  const { interactionsService, tokenService } = options
  const requireAuth = createRequireAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()
  const params = z.object({ id: snowflakeIdSchema })
  // DELETE handlers are idempotent no-ops on a missing interaction — they
  // never 404. POST handlers do, via assertPostExists / findPostById.
  const deleteResponses = { 204: z.null(), 401: errorResponseSchema }
  const createResponses = {
    204: z.null(),
    401: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  }

  server.post(
    '/posts/:id/like',
    {
      schema: { params, response: { ...createResponses, 429: errorResponseSchema } },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await enforceRateLimit(
        app.redis,
        `like:${user.id}`,
        LIKE_RATE_LIMIT.limit,
        LIKE_RATE_LIMIT.windowMs,
      )
      await interactionsService.like(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )

  server.delete(
    '/posts/:id/like',
    { schema: { params, response: deleteResponses }, preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await interactionsService.unlike(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )

  server.post(
    '/posts/:id/bookmark',
    { schema: { params, response: createResponses }, preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await interactionsService.bookmark(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )

  server.delete(
    '/posts/:id/bookmark',
    { schema: { params, response: deleteResponses }, preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await interactionsService.unbookmark(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )

  server.post(
    '/posts/:id/repost',
    {
      schema: {
        params,
        response: {
          201: postResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const repost = await interactionsService.repost(user.id, BigInt(request.params.id))
      return reply.status(201).send({ data: repost })
    },
  )

  server.delete(
    '/posts/:id/repost',
    { schema: { params, response: deleteResponses }, preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await interactionsService.unrepost(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )
}
