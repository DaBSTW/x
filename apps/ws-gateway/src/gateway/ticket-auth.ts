import { realtimeTicketKey, sha256Hex } from '@x/utils'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Redis } from 'ioredis'

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the preHandler below once redeemed — never read before it runs, since an unresolved ticket rejects the request outright. */
    realtimeUserId?: bigint
  }
}

/**
 * Redeems the one-time connection ticket — SPECS.md §8.1 — before either
 * realtime route does anything else. Shared between gateway.plugin.ts (the
 * WebSocket upgrade) and sse.plugin.ts (a plain SSE GET): a `{ websocket:
 * true }` route still runs the normal Fastify `preHandler` lifecycle before
 * `@fastify/websocket` hijacks the connection, and an SSE route is nothing
 * more than a GET whose handler never returns — so the exact same
 * "redeem-then-reject-as-plain-HTTP" preHandler works unmodified for both
 * (verified against the plugin's own source — `routeOptions.handler` is
 * what gets wrapped, not the whole route lifecycle).
 */
export function createTicketPreHandler(redis: Redis, corsOrigin: string) {
  return async function verifyTicket(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Every response this preHandler ever sends carries this — a no-op for
    // the WebSocket route (a rejected upgrade isn't subject to CORS at
    // all), but required for sse.plugin.ts's EventSource requests, which
    // *are* plain fetches under the browser's normal CORS enforcement. Set
    // once, here, rather than duplicated in both route handlers.
    void reply.header('access-control-allow-origin', corsOrigin)
    void reply.header('vary', 'origin')

    // Not a hard requirement (a non-browser client may send no Origin at
    // all), only a rejection when one is present and wrong — defense in
    // depth on top of the ticket itself, which is the real access control.
    const origin = request.headers.origin
    if (origin !== undefined && origin !== corsOrigin) {
      await reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'origin not allowed' } })
      return
    }

    const query = request.query as Record<string, unknown>
    const ticket = typeof query.ticket === 'string' ? query.ticket : undefined
    if (!ticket) {
      await reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'missing ticket' } })
      return
    }

    const rawUserId = await redis.getdel(realtimeTicketKey(sha256Hex(ticket)))
    if (!rawUserId) {
      await reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'invalid or expired ticket' } })
      return
    }

    request.realtimeUserId = BigInt(rawUserId)
  }
}
