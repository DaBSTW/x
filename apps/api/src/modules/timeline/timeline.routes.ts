import { errorResponseSchema, paginationQuerySchema, postListResponseSchema } from '@x/contracts'
import { decodeCursor, encodeCursor } from '@x/utils'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { createRequireAuth, getAuthenticatedUser } from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { TimelineService } from './timeline.service.js'

export type TimelineRoutesOptions = {
  timelineService: TimelineService
  tokenService: TokenService
}

export async function registerTimelineRoutes(app: FastifyInstance, options: TimelineRoutesOptions) {
  const { timelineService, tokenService } = options
  const requireAuth = createRequireAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/timeline/home',
    {
      schema: {
        querystring: paginationQuerySchema,
        response: { 200: postListResponseSchema, 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const cursor = request.query.cursor ? decodeCursor(request.query.cursor) : null
      const { items, hasMore } = await timelineService.getHome(user.id, request.query.limit, cursor)
      const lastItem = items.at(-1)
      const nextCursor = hasMore && lastItem ? encodeCursor(BigInt(lastItem.id)) : null

      return reply.send({ data: items, meta: { nextCursor, prevCursor: null, hasMore } })
    },
  )
}
