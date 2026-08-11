import {
  errorResponseSchema,
  listSessionsResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
  registerResponseSchema,
  tokenPairResponseSchema,
  verifyEmailRequestSchema,
} from '@x/contracts'
import { UnauthenticatedError } from '@x/utils'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { enforceRateLimit } from '../../lib/rate-limit.js'
import { createRequireAuth, getAuthenticatedUser } from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { AuthService } from './auth.service.js'

const REFRESH_COOKIE_NAME = 'refresh_token'
const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 }

export type AuthRoutesOptions = {
  authService: AuthService
  tokenService: TokenService
  refreshTokenTtlDays: number
  nodeEnv: string
}

export async function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions) {
  const { authService, tokenService, refreshTokenTtlDays, nodeEnv } = options
  const requireAuth = createRequireAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()

  function setRefreshCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: nodeEnv === 'production',
      sameSite: 'lax',
      path: '/v1/auth',
      maxAge: refreshTokenTtlDays * 24 * 60 * 60,
    })
  }

  server.post(
    '/register',
    {
      schema: {
        body: registerRequestSchema,
        response: { 201: registerResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const user = await authService.register(request.body)
      return reply.status(201).send({
        data: {
          id: user.id.toString(),
          username: user.username,
          email: user.email,
          emailVerified: false,
        },
      })
    },
  )

  server.post(
    '/verify-email',
    {
      schema: {
        body: verifyEmailRequestSchema,
        response: { 200: z.object({ data: z.object({ verified: z.literal(true) }) }) },
      },
    },
    async (request, reply) => {
      await authService.verifyEmail(request.body.token)
      return reply.send({ data: { verified: true } })
    },
  )

  server.post(
    '/login',
    {
      schema: {
        body: loginRequestSchema,
        response: {
          200: tokenPairResponseSchema,
          401: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      await enforceRateLimit(
        app.redis,
        `login:ip:${request.ip}`,
        LOGIN_RATE_LIMIT.limit,
        LOGIN_RATE_LIMIT.windowMs,
      )

      const meta = { ipAddress: request.ip, userAgent: request.headers['user-agent'] ?? null }
      const tokens = await authService.login(request.body, meta)

      setRefreshCookie(reply, tokens.refreshToken)
      return reply.send({
        data: { accessToken: tokens.accessToken, expiresInSeconds: tokens.expiresInSeconds },
      })
    },
  )

  server.post(
    '/refresh',
    { schema: { response: { 200: tokenPairResponseSchema, 401: errorResponseSchema } } },
    async (request, reply) => {
      const rawToken = request.cookies[REFRESH_COOKIE_NAME]
      if (!rawToken) {
        throw new UnauthenticatedError('missing refresh token cookie')
      }

      const meta = { ipAddress: request.ip, userAgent: request.headers['user-agent'] ?? null }
      const tokens = await authService.refresh(rawToken, meta)

      setRefreshCookie(reply, tokens.refreshToken)
      return reply.send({
        data: { accessToken: tokens.accessToken, expiresInSeconds: tokens.expiresInSeconds },
      })
    },
  )

  server.post('/logout', { schema: { response: { 204: z.null() } } }, async (request, reply) => {
    const rawToken = request.cookies[REFRESH_COOKIE_NAME]
    if (rawToken) {
      await authService.logout(rawToken)
    }
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/v1/auth' })
    return reply.status(204).send(null)
  })

  server.post(
    '/logout-all',
    {
      schema: { response: { 204: z.null(), 401: errorResponseSchema } },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await authService.logoutAll(user.id)
      reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/v1/auth' })
      return reply.status(204).send(null)
    },
  )

  server.get(
    '/sessions',
    {
      schema: { response: { 200: listSessionsResponseSchema, 401: errorResponseSchema } },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const sessions = await authService.listSessions(user.id, user.sessionId)
      return reply.send({ data: sessions })
    },
  )
}
