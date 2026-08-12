import {
  errorResponseSchema,
  followListResponseSchema,
  followRequestListResponseSchema,
  followResponseSchema,
  paginationQuerySchema,
  snowflakeIdSchema,
  suggestionsResponseSchema,
} from '@x/contracts'
import { decodeCursor, encodeCursor } from '@x/utils'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { createRequireAuth, getAuthenticatedUser } from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { SocialGraphService } from './social-graph.service.js'

export type SocialGraphRoutesOptions = {
  socialGraphService: SocialGraphService
  tokenService: TokenService
}

export async function registerSocialGraphRoutes(
  app: FastifyInstance,
  options: SocialGraphRoutesOptions,
) {
  const { socialGraphService, tokenService } = options
  const requireAuth = createRequireAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.post(
    '/users/:id/follow',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: {
          // ROADMAP.md 2.6: a protected target creates a request instead of
          // an immediate follow — the caller needs to know which happened.
          200: followResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const result = await socialGraphService.follow(user.id, BigInt(request.params.id))
      return reply.send({ data: result })
    },
  )

  server.delete(
    '/users/:id/follow',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: { 204: z.null(), 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await socialGraphService.unfollow(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )

  // Table + endpoints landed in ROADMAP.md 1.2; posts.service.ts,
  // timeline.service.ts and apps/workers' notifications worker are the
  // readers that actually enforce them now (ROADMAP.md 2.6).
  server.post(
    '/users/:id/block',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: {
          204: z.null(),
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await socialGraphService.block(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )

  server.delete(
    '/users/:id/block',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: { 204: z.null(), 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await socialGraphService.unblock(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )

  server.post(
    '/users/:id/mute',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: {
          204: z.null(),
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await socialGraphService.mute(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )

  server.delete(
    '/users/:id/mute',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: { 204: z.null(), 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await socialGraphService.unmute(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )

  // Static segment sharing `/users/*` with profiles.routes.ts's `/users/:username`
  // — find-my-way always prefers the static match, so this can never be
  // captured as a username (verified precedent: profiles.routes.ts's `/users/me`).
  server.get(
    '/users/suggestions',
    {
      schema: {
        querystring: paginationQuerySchema.pick({ limit: true }),
        response: { 200: suggestionsResponseSchema, 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const suggestions = await socialGraphService.getSuggestions(user.id, request.query.limit)
      return reply.send({ data: suggestions })
    },
  )

  server.get(
    '/users/:username/followers',
    {
      schema: {
        params: z.object({ username: z.string() }),
        querystring: paginationQuerySchema,
        response: { 200: followListResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const cursor = request.query.cursor
        ? new Date(Number(decodeCursor(request.query.cursor)))
        : null
      const page = await socialGraphService.listFollowers(
        request.params.username.toLowerCase(),
        request.query.limit,
        cursor,
      )
      const nextCursor =
        page.hasMore && page.lastCreatedAt
          ? encodeCursor(BigInt(page.lastCreatedAt.getTime()))
          : null
      return reply.send({
        data: page.items,
        meta: { nextCursor, prevCursor: null, hasMore: page.hasMore },
      })
    },
  )

  server.get(
    '/users/:username/following',
    {
      schema: {
        params: z.object({ username: z.string() }),
        querystring: paginationQuerySchema,
        response: { 200: followListResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const cursor = request.query.cursor
        ? new Date(Number(decodeCursor(request.query.cursor)))
        : null
      const page = await socialGraphService.listFollowing(
        request.params.username.toLowerCase(),
        request.query.limit,
        cursor,
      )
      const nextCursor =
        page.hasMore && page.lastCreatedAt
          ? encodeCursor(BigInt(page.lastCreatedAt.getTime()))
          : null
      return reply.send({
        data: page.items,
        meta: { nextCursor, prevCursor: null, hasMore: page.hasMore },
      })
    },
  )

  // ROADMAP.md 2.6 "cuentas protegidas" — static `/users/me/...` segment,
  // same routing precedent as /users/me and /users/suggestions above.
  server.get(
    '/users/me/follow-requests',
    {
      schema: {
        querystring: paginationQuerySchema,
        response: { 200: followRequestListResponseSchema, 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const cursor = request.query.cursor
        ? new Date(Number(decodeCursor(request.query.cursor)))
        : null
      const page = await socialGraphService.listFollowRequests(user.id, request.query.limit, cursor)
      const nextCursor =
        page.hasMore && page.lastCreatedAt
          ? encodeCursor(BigInt(page.lastCreatedAt.getTime()))
          : null
      return reply.send({
        data: page.items,
        meta: { nextCursor, prevCursor: null, hasMore: page.hasMore },
      })
    },
  )

  server.post(
    '/users/me/follow-requests/:id/accept',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: { 204: z.null(), 401: errorResponseSchema, 404: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await socialGraphService.acceptFollowRequest(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )

  server.delete(
    '/users/me/follow-requests/:id',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: { 204: z.null(), 401: errorResponseSchema, 404: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await socialGraphService.rejectFollowRequest(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )
}
