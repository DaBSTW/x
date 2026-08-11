import {
  errorResponseSchema,
  finalizeMediaResponseSchema,
  mediaResponseSchema,
  snowflakeIdSchema,
  updateMediaSchema,
  uploadMediaRequestSchema,
  uploadMediaResponseSchema,
} from '@x/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { createRequireAuth, getAuthenticatedUser } from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { MediaService } from './media.service.js'

export type MediaRoutesOptions = {
  mediaService: MediaService
  tokenService: TokenService
}

export async function registerMediaRoutes(app: FastifyInstance, options: MediaRoutesOptions) {
  const { mediaService, tokenService } = options
  const requireAuth = createRequireAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()
  const params = z.object({ id: snowflakeIdSchema })

  server.post(
    '/media/upload-url',
    {
      schema: {
        body: uploadMediaRequestSchema,
        response: { 201: uploadMediaResponseSchema, 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const result = await mediaService.createUploadUrl(user.id, request.body.mimeType)
      return reply.status(201).send({ data: result })
    },
  )

  server.post(
    '/media/:id/finalize',
    {
      schema: {
        params,
        response: {
          200: finalizeMediaResponseSchema,
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
      const result = await mediaService.finalize(BigInt(request.params.id), user.id)
      return reply.send({ data: result })
    },
  )

  server.get(
    '/media/:id',
    {
      schema: {
        params,
        response: {
          200: mediaResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const item = await mediaService.getById(BigInt(request.params.id), user.id)
      return reply.send({ data: item })
    },
  )

  server.patch(
    '/media/:id',
    {
      schema: {
        params,
        body: updateMediaSchema,
        response: {
          200: mediaResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const item = await mediaService.updateAltText(
        BigInt(request.params.id),
        user.id,
        request.body.altText,
      )
      return reply.send({ data: item })
    },
  )
}
