import { errorResponseSchema, realtimeTicketResponseSchema } from '@x/contracts'
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
}
