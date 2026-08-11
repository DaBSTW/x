import {
  conversationListResponseSchema,
  conversationResponseSchema,
  createConversationSchema,
  errorResponseSchema,
  markReadSchema,
  messageListResponseSchema,
  messageSchema,
  paginationQuerySchema,
  sendMessageSchema,
  snowflakeIdSchema,
} from '@x/contracts'
import { decodeCursor, encodeCursor } from '@x/utils'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { createRequireAuth, getAuthenticatedUser } from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { ConversationsService } from './conversations.service.js'

export type ConversationsRoutesOptions = {
  conversationsService: ConversationsService
  tokenService: TokenService
}

export async function registerConversationsRoutes(
  app: FastifyInstance,
  options: ConversationsRoutesOptions,
) {
  const { conversationsService, tokenService } = options
  const requireAuth = createRequireAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.post(
    '/conversations',
    {
      schema: {
        body: createConversationSchema,
        response: {
          201: conversationResponseSchema,
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
      const conversation = await conversationsService.create(user.id, {
        memberIds: request.body.memberIds.map((id) => BigInt(id)),
        isGroup: request.body.isGroup,
        name: request.body.name,
      })
      return reply.status(201).send({ data: conversation })
    },
  )

  server.get(
    '/conversations',
    {
      schema: {
        querystring: paginationQuerySchema,
        response: { 200: conversationListResponseSchema, 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const cursor = request.query.cursor ? decodeCursor(request.query.cursor) : null
      const { items, hasMore } = await conversationsService.listConversations(
        user.id,
        request.query.limit,
        cursor,
      )
      const lastItem = items.at(-1)
      const nextCursor = hasMore && lastItem ? encodeCursor(BigInt(lastItem.id)) : null
      return reply.send({ data: items, meta: { nextCursor, prevCursor: null, hasMore } })
    },
  )

  server.get(
    '/conversations/:id/messages',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        querystring: paginationQuerySchema,
        response: {
          200: messageListResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const cursor = request.query.cursor ? decodeCursor(request.query.cursor) : null
      const { items, hasMore } = await conversationsService.listMessages(
        BigInt(request.params.id),
        user.id,
        request.query.limit,
        cursor,
      )
      const lastItem = items.at(-1)
      const nextCursor = hasMore && lastItem ? encodeCursor(BigInt(lastItem.id)) : null
      return reply.send({ data: items, meta: { nextCursor, prevCursor: null, hasMore } })
    },
  )

  server.post(
    '/conversations/:id/messages',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        body: sendMessageSchema,
        response: {
          201: z.object({ data: messageSchema }),
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const message = await conversationsService.sendMessage(
        BigInt(request.params.id),
        user.id,
        request.body.text,
      )
      return reply.status(201).send({ data: message })
    },
  )

  server.post(
    '/conversations/:id/read',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        body: markReadSchema,
        response: { 204: z.null(), 401: errorResponseSchema, 404: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await conversationsService.markRead(
        BigInt(request.params.id),
        user.id,
        BigInt(request.body.messageId),
      )
      return reply.status(204).send(null)
    },
  )
}
