import {
  errorResponseSchema,
  searchQuerySchema,
  searchResponseSchema,
  typeaheadQuerySchema,
  typeaheadResponseSchema,
} from '@x/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { createOptionalAuth } from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { SearchService } from './search.service.js'

export type SearchRoutesOptions = {
  searchService: SearchService
  tokenService: TokenService
}

export async function registerSearchRoutes(app: FastifyInstance, options: SearchRoutesOptions) {
  const { searchService, tokenService } = options
  const optionalAuth = createOptionalAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()

  // Public, personalized when signed in — same optionalAuth posture as
  // GET /users/:username and GET /trends: a discovery surface, not
  // account-specific data. Signed-in only changes viewer state on results
  // and the 'top' mode's social-affinity ranking signal, never what's
  // visible at all.
  server.get(
    '/search',
    {
      schema: {
        querystring: searchQuerySchema,
        response: { 200: searchResponseSchema, 400: errorResponseSchema },
      },
      preHandler: [optionalAuth],
    },
    async (request, reply) => {
      const { q, type, limit, cursor } = request.query
      const { items, hasMore, nextCursor } = await searchService.search(
        q,
        type,
        limit,
        cursor,
        request.user?.id,
      )
      return reply.send({ data: items, meta: { nextCursor, prevCursor: null, hasMore } })
    },
  )

  // Same optionalAuth posture as GET /search above — public, personalized
  // only in that a blocked/blocking relationship hides someone from the
  // dropdown when signed in (hydratePeople, search.service.ts).
  server.get(
    '/search/typeahead',
    {
      schema: {
        querystring: typeaheadQuerySchema,
        response: { 200: typeaheadResponseSchema, 400: errorResponseSchema },
      },
      preHandler: [optionalAuth],
    },
    async (request, reply) => {
      const { q, limit } = request.query
      const data = await searchService.typeahead(q, limit, request.user?.id)
      return reply.send({ data })
    },
  )
}
