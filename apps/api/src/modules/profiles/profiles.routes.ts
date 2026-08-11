import { errorResponseSchema, updateUserSchema, userProfileResponseSchema } from '@x/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { createRequireAuth, getAuthenticatedUser } from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { ProfilesService } from './profiles.service.js'

export type ProfilesRoutesOptions = {
  profilesService: ProfilesService
  tokenService: TokenService
}

export async function registerProfilesRoutes(app: FastifyInstance, options: ProfilesRoutesOptions) {
  const { profilesService, tokenService } = options
  const requireAuth = createRequireAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()

  // Registered ahead of the parametric route below for readability;
  // find-my-way (Fastify's router) always prefers a static segment over a
  // `:param` one regardless of registration order, so "me" can never be
  // captured as `:username`.
  server.get(
    '/users/me',
    {
      schema: { response: { 200: userProfileResponseSchema, 401: errorResponseSchema } },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const profile = await profilesService.getById(user.id)
      return reply.send({ data: profile })
    },
  )

  server.get(
    '/users/:username',
    {
      schema: {
        params: z.object({ username: z.string() }),
        response: { 200: userProfileResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const profile = await profilesService.getByUsername(request.params.username.toLowerCase())
      return reply.send({ data: profile })
    },
  )

  server.patch(
    '/users/me',
    {
      schema: {
        body: updateUserSchema,
        response: { 200: userProfileResponseSchema, 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const profile = await profilesService.updateMe(user.id, request.body)
      return reply.send({ data: profile })
    },
  )
}
