import { UnauthenticatedError } from '@x/utils'
import type { FastifyRequest } from 'fastify'
import type { TokenService } from '../plugins/tokens.js'

export type AuthenticatedUser = {
  id: bigint
  sessionId: bigint
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser
  }
}

/**
 * Builds the `preHandler` that every authenticated route declares explicitly
 * — CODESTYLE.md §12 ("la autorización no se hace a mano dentro del
 * handler"). Populates `request.user` from the Bearer access token.
 */
export function createRequireAuth(tokenService: TokenService) {
  return async function requireAuth(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined

    if (!token) {
      throw new UnauthenticatedError('missing bearer token')
    }

    const claims = await tokenService.verifyAccessToken(token)
    request.user = { id: BigInt(claims.sub), sessionId: BigInt(claims.sid) }
  }
}

/**
 * Reads `request.user` after `requireAuth` ran. Throws instead of asserting
 * non-null — CODESTYLE.md §6 bans `!`, so a route wired without the
 * `requireAuth` preHandler fails loudly here rather than crashing on a
 * `Cannot read properties of undefined`.
 */
export function getAuthenticatedUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) {
    throw new UnauthenticatedError('route requires requireAuth preHandler')
  }
  return request.user
}

/**
 * For routes that stay public but personalize when a caller happens to be
 * signed in — e.g. filtering a blocked author out of a post that anyone can
 * otherwise fetch (ROADMAP.md 2.6). Unlike `requireAuth`, a missing or
 * invalid token is not an error: the request just proceeds anonymous
 * (`request.user` stays unset), it never fails the route.
 */
export function createOptionalAuth(tokenService: TokenService) {
  return async function optionalAuth(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
    if (!token) return

    try {
      const claims = await tokenService.verifyAccessToken(token)
      request.user = { id: BigInt(claims.sub), sessionId: BigInt(claims.sid) }
    } catch {
      // Expired/malformed token on an otherwise-public route: degrade to
      // anonymous rather than failing a request that didn't require auth.
    }
  }
}
