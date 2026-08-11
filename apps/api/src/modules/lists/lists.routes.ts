import {
  createListSchema,
  errorResponseSchema,
  listListResponseSchema,
  listResponseSchema,
  paginationQuerySchema,
  postListResponseSchema,
  snowflakeIdSchema,
  updateListSchema,
} from '@x/contracts'
import { decodeCursor, encodeCursor } from '@x/utils'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  createOptionalAuth,
  createRequireAuth,
  getAuthenticatedUser,
} from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { ListsService } from './lists.service.js'

export type ListsRoutesOptions = {
  listsService: ListsService
  tokenService: TokenService
}

export async function registerListsRoutes(app: FastifyInstance, options: ListsRoutesOptions) {
  const { listsService, tokenService } = options
  const requireAuth = createRequireAuth(tokenService)
  const optionalAuth = createOptionalAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.post(
    '/lists',
    {
      schema: {
        body: createListSchema,
        response: { 201: listResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const list = await listsService.create(user.id, request.body)
      return reply.status(201).send({ data: list })
    },
  )

  server.get(
    '/lists/:id',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: { 200: listResponseSchema, 404: errorResponseSchema },
      },
      preHandler: [optionalAuth],
    },
    async (request, reply) => {
      const list = await listsService.getById(BigInt(request.params.id), request.user?.id)
      return reply.send({ data: list })
    },
  )

  server.patch(
    '/lists/:id',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        body: updateListSchema,
        response: {
          200: listResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const list = await listsService.update(BigInt(request.params.id), user.id, request.body)
      return reply.send({ data: list })
    },
  )

  server.delete(
    '/lists/:id',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: {
          204: z.null(),
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await listsService.remove(BigInt(request.params.id), user.id)
      return reply.status(204).send(null)
    },
  )

  server.post(
    '/lists/:id/members/:userId',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema, userId: snowflakeIdSchema }),
        response: {
          204: z.null(),
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
      await listsService.addMember(
        BigInt(request.params.id),
        user.id,
        BigInt(request.params.userId),
      )
      return reply.status(204).send(null)
    },
  )

  server.delete(
    '/lists/:id/members/:userId',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema, userId: snowflakeIdSchema }),
        response: {
          204: z.null(),
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await listsService.removeMember(
        BigInt(request.params.id),
        user.id,
        BigInt(request.params.userId),
      )
      return reply.status(204).send(null)
    },
  )

  server.get(
    '/users/:username/lists',
    {
      schema: {
        params: z.object({ username: z.string() }),
        querystring: paginationQuerySchema,
        response: { 200: listListResponseSchema, 404: errorResponseSchema },
      },
      preHandler: [optionalAuth],
    },
    async (request, reply) => {
      const cursor = request.query.cursor ? decodeCursor(request.query.cursor) : null
      const { items, hasMore } = await listsService.listByOwner(
        request.params.username.toLowerCase(),
        request.query.limit,
        cursor,
        request.user?.id,
      )
      const lastItem = items.at(-1)
      const nextCursor = hasMore && lastItem ? encodeCursor(BigInt(lastItem.id)) : null
      return reply.send({ data: items, meta: { nextCursor, prevCursor: null, hasMore } })
    },
  )

  // SPECS.md §8's Timelines table places this under /timeline, but the
  // underlying logic is entirely list-owned — same precedent as
  // social-graph.routes.ts registering /users/:id/follow instead of
  // profiles.routes.ts just because both share a path prefix.
  server.get(
    '/timeline/list/:id',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        querystring: paginationQuerySchema,
        response: { 200: postListResponseSchema, 404: errorResponseSchema },
      },
      preHandler: [optionalAuth],
    },
    async (request, reply) => {
      const cursor = request.query.cursor ? decodeCursor(request.query.cursor) : null
      const { items, hasMore } = await listsService.getTimeline(
        BigInt(request.params.id),
        request.user?.id,
        request.query.limit,
        cursor,
      )
      const lastItem = items.at(-1)
      const nextCursor = hasMore && lastItem ? encodeCursor(BigInt(lastItem.id)) : null
      return reply.send({ data: items, meta: { nextCursor, prevCursor: null, hasMore } })
    },
  )
}
