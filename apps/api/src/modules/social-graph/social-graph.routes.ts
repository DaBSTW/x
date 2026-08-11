import {
  errorResponseSchema,
  followListResponseSchema,
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
        response: { 204: z.null(), 404: errorResponseSchema, 409: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await socialGraphService.follow(user.id, BigInt(request.params.id))
      return reply.status(204).send(null)
    },
  )

  server.delete(
    '/users/:id/follow',
    {
      schema: { params: z.object({ id: snowflakeIdSchema }), response: { 204: z.null() } },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await socialGraphService.unfollow(user.id, BigInt(request.params.id))
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
}
