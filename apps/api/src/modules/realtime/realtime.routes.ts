import {
  errorResponseSchema,
  realtimePollQuerySchema,
  realtimePollResponseSchema,
  realtimeTicketResponseSchema,
} from '@x/contracts'
import { ForbiddenError } from '@x/utils'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { createRequireAuth, getAuthenticatedUser } from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { RealtimeService } from './realtime.service.js'

export type RealtimeRoutesOptions = {
  realtimeService: RealtimeService
  tokenService: TokenService
}

export async function registerRealtimeRoutes(app: FastifyInstance, options: RealtimeRoutesOptions) {
  const { realtimeService, tokenService } = options
  const requireAuth = createRequireAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.post(
    '/realtime/ticket',
    {
      schema: {
        response: { 200: realtimeTicketResponseSchema, 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const { ticket, expiresIn } = await realtimeService.issueTicket(user.id)
      return reply.send({ data: { ticket, expiresIn } })
    },
  )

  // ROADMAP.md 2.2's "último caso, polling adaptativo" — a plain
  // JWT-authenticated GET, unlike /realtime/ticket above, since there's no
  // upgrade step to protect a bearer token from (realtime.ts's own comment
  // on why). apps/web's use-polling-transport.ts is the one caller this
  // ships with, but the route itself has no idea it's a last resort — it's
  // just "missed events on a channel since X," same shape a curious client
  // could call directly.
  server.get(
    '/realtime/poll',
    {
      schema: {
        querystring: realtimePollQuerySchema,
        response: {
          200: realtimePollResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const { channel, since } = request.query
      const outcome = await realtimeService.pollChannel(user.id, channel, since)
      if (!outcome.allowed) {
        throw new ForbiddenError('not authorized for this channel', { channel })
      }
      return reply.send({ data: { events: outcome.events, latestEventId: outcome.latestEventId } })
    },
  )
}
