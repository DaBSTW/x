import {
  errorResponseSchema,
  markNotificationsReadSchema,
  notificationListResponseSchema,
  paginationQuerySchema,
  unreadCountResponseSchema,
} from '@x/contracts'
import { decodeCursor, encodeCursor } from '@x/utils'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { createRequireAuth, getAuthenticatedUser } from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { NotificationsService } from './notifications.service.js'

export type NotificationsRoutesOptions = {
  notificationsService: NotificationsService
  tokenService: TokenService
}

export async function registerNotificationsRoutes(
  app: FastifyInstance,
  options: NotificationsRoutesOptions,
) {
  const { notificationsService, tokenService } = options
  const requireAuth = createRequireAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/notifications',
    {
      schema: {
        querystring: paginationQuerySchema,
        response: { 200: notificationListResponseSchema, 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const cursor = request.query.cursor ? decodeCursor(request.query.cursor) : null
      const { items, hasMore } = await notificationsService.list(
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
    '/notifications/unread-count',
    {
      schema: { response: { 200: unreadCountResponseSchema, 401: errorResponseSchema } },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const count = await notificationsService.getUnreadCount(user.id)
      return reply.send({ data: { count } })
    },
  )

  server.post(
    '/notifications/read',
    {
      schema: {
        body: markNotificationsReadSchema,
        response: { 204: z.null(), 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await notificationsService.markRead(user.id, BigInt(request.body.cursor))
      return reply.status(204).send(null)
    },
  )
}
