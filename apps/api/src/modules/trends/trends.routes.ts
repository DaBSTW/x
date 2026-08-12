import { errorResponseSchema, trendsQuerySchema, trendsResponseSchema } from '@x/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { TrendsService } from './trends.service.js'

export type TrendsRoutesOptions = {
  trendsService: TrendsService
}

export async function registerTrendsRoutes(app: FastifyInstance, options: TrendsRoutesOptions) {
  const { trendsService } = options
  const server = app.withTypeProvider<ZodTypeProvider>()

  // Public, like GET /users/:username and GET /posts/:id — trending topics
  // are a discovery surface, not account-specific data (ROADMAP.md 2.4).
  server.get(
    '/trends',
    {
      schema: {
        querystring: trendsQuerySchema,
        response: { 200: trendsResponseSchema, 400: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { lang, limit } = request.query
      const data = await trendsService.listTrends(lang, limit)
      return reply.send({ data })
    },
  )
}
