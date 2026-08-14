import {
  errorResponseSchema,
  pushSubscribeRequestSchema,
  pushUnsubscribeRequestSchema,
  registerDeviceTokenRequestSchema,
  unregisterDeviceTokenRequestSchema,
  vapidPublicKeyResponseSchema,
} from '@x/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { createRequireAuth, getAuthenticatedUser } from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { PushService } from './push.service.js'

export type PushRoutesOptions = {
  pushService: PushService
  tokenService: TokenService
}

export async function registerPushRoutes(app: FastifyInstance, options: PushRoutesOptions) {
  const { pushService, tokenService } = options
  const requireAuth = createRequireAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()

  // Public — the VAPID public key isn't a secret (it's handed to every
  // subscribing browser anyway), and the browser needs it before the user
  // is necessarily logged in on a fresh session.
  server.get(
    '/push/vapid-public-key',
    { schema: { response: { 200: vapidPublicKeyResponseSchema } } },
    async (_request, reply) => {
      return reply.send({ data: { publicKey: pushService.getVapidPublicKey() } })
    },
  )

  server.post(
    '/push/subscriptions',
    {
      schema: {
        body: pushSubscribeRequestSchema,
        response: { 204: z.null(), 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await pushService.subscribe(user.id, {
        endpoint: request.body.endpoint,
        p256dh: request.body.keys.p256dh,
        authKey: request.body.keys.auth,
        userAgent: request.headers['user-agent'] ?? null,
      })
      return reply.status(204).send(null)
    },
  )

  server.delete(
    '/push/subscriptions',
    {
      schema: {
        body: pushUnsubscribeRequestSchema,
        response: { 204: z.null(), 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await pushService.unsubscribe(user.id, request.body.endpoint)
      return reply.status(204).send(null)
    },
  )

  // ROADMAP.md 2.9's FCM/APNs bullet — same shape as /push/subscriptions
  // above, for a native device token instead of a browser subscription.
  // Nothing in apps/web calls these; they exist for the mobile app
  // ROADMAP.md 4 will build, tested here against the real API/DB in the
  // meantime so the surface is genuinely ready, not just planned.
  server.post(
    '/push/device-tokens',
    {
      schema: {
        body: registerDeviceTokenRequestSchema,
        response: { 204: z.null(), 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await pushService.registerDeviceToken(user.id, request.body)
      return reply.status(204).send(null)
    },
  )

  server.delete(
    '/push/device-tokens',
    {
      schema: {
        body: unregisterDeviceTokenRequestSchema,
        response: { 204: z.null(), 401: errorResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await pushService.unregisterDeviceToken(user.id, request.body.token)
      return reply.status(204).send(null)
    },
  )
}
