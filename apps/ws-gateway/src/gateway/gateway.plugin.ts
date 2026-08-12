import { realtimeClientMessageSchema } from '@x/contracts'
import { realtimeTicketKey, sha256Hex } from '@x/utils'
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Redis } from 'ioredis'
import type { WebSocket } from 'ws'
import type { ConnectionRegistry } from './connection-registry.js'
import type { RealtimeRepository } from './realtime.repository.js'
import { createSubscriptionHandler } from './subscription-handler.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the ticket preHandler below once redeemed — never read before it runs, since an unresolved ticket rejects the upgrade outright. */
    realtimeUserId?: bigint
  }
}

export type GatewayPluginOptions = {
  /** General-purpose connection — ticket redemption (`GETDEL`). */
  redis: Redis
  /** Dedicated to SUBSCRIBE mode: a Redis connection that has issued `SUBSCRIBE` can't issue any other command, ioredis's own documented restriction — so this must be a second connection, never the one above. */
  subscriber: Redis
  registry: ConnectionRegistry
  repository: RealtimeRepository
  corsOrigin: string
  heartbeatIntervalMs: number
  heartbeatTimeoutMs: number
  backpressureLimitBytes: number
}

/**
 * Redeems the one-time connection ticket — SPECS.md §8.1 — before the
 * WebSocket upgrade happens at all. `@fastify/websocket` only hijacks the
 * route *handler*; a `{ websocket: true }` route still runs the normal
 * Fastify `preHandler` lifecycle first, so rejecting here sends a plain
 * HTTP 401/403 and the upgrade never occurs (verified against the plugin's
 * own source — `routeOptions.handler` is what gets wrapped, not the whole
 * route lifecycle).
 */
function createTicketPreHandler(redis: Redis, corsOrigin: string) {
  return async function verifyTicket(request: FastifyRequest, reply: FastifyReply): Promise<void> {
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

/** Sends a pre-serialized message, closing the connection instead if its write queue is already backed up — SPECS.md §8.3's backpressure rule. */
function sendRaw(
  socket: WebSocket,
  message: string,
  backpressureLimitBytes: number,
  logger: FastifyBaseLogger,
): void {
  if (socket.bufferedAmount > backpressureLimitBytes) {
    logger.warn(
      { bufferedAmount: socket.bufferedAmount },
      'closing a realtime connection over the backpressure limit',
    )
    socket.terminate()
    return
  }
  socket.send(message)
}

export async function registerGatewayRoutes(
  app: FastifyInstance,
  options: GatewayPluginOptions,
): Promise<void> {
  const {
    redis,
    subscriber,
    registry,
    repository,
    corsOrigin,
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    backpressureLimitBytes,
  } = options

  const subscriptions = createSubscriptionHandler({ registry, repository, subscriber })
  const socketsByConnectionId = new Map<string, WebSocket>()
  let nextConnectionId = 0

  // One shared Redis subscriber connection dispatches every incoming
  // pub/sub message to whichever of *this process's* connections currently
  // care about that channel — SPECS.md §8.3's "cada instancia mantiene un
  // mapa channel → Set<connection>." A raw relay on purpose: the publisher
  // (a future checkpoint — nothing publishes real domain events yet) is
  // trusted to have already built a wire-format-correct envelope, the same
  // trust boundary this codebase already gives BullMQ job payloads.
  subscriber.on('message', (channel: string, raw: string) => {
    for (const connectionId of registry.connectionsFor(channel)) {
      const socket = socketsByConnectionId.get(connectionId)
      if (socket) sendRaw(socket, raw, backpressureLimitBytes, app.log)
    }
  })

  app.get(
    '/v1',
    { websocket: true, preHandler: [createTicketPreHandler(redis, corsOrigin)] },
    (socket, request) => {
      if (request.realtimeUserId === undefined) {
        // Unreachable in practice — the preHandler above either set this or
        // already rejected the upgrade — but CODESTYLE.md §6 bans `!`, so
        // fail loudly instead of running a socket with no identity.
        socket.close(1011, 'internal error')
        return
      }
      // Rebound to a fresh `const`: TS doesn't carry the narrowing above
      // through the `handleMessage` closure below since it's a captured
      // property access, not a local binding.
      const userId: bigint = request.realtimeUserId

      const connectionId = String(nextConnectionId++)
      socketsByConnectionId.set(connectionId, socket)
      const send = (message: string) => sendRaw(socket, message, backpressureLimitBytes, app.log)

      // --- Heartbeat (SPECS.md §8.3): ping every heartbeatIntervalMs;
      // close if heartbeatTimeoutMs pass with no pong. A single timer
      // re-armed on every pong gives an exact timeout instead of only one
      // approximate to within the check interval.
      let heartbeatTimeout: NodeJS.Timeout
      function armHeartbeatTimeout(): void {
        clearTimeout(heartbeatTimeout)
        heartbeatTimeout = setTimeout(() => socket.terminate(), heartbeatTimeoutMs)
      }
      armHeartbeatTimeout()
      socket.on('pong', armHeartbeatTimeout)
      const pingInterval = setInterval(() => {
        if (socket.readyState === socket.OPEN) socket.ping()
      }, heartbeatIntervalMs)

      socket.on('close', () => {
        clearTimeout(heartbeatTimeout)
        clearInterval(pingInterval)
        socketsByConnectionId.delete(connectionId)
        void subscriptions
          .disconnect(connectionId)
          .catch((error: unknown) =>
            app.log.error({ err: error, connectionId }, 'failed to clean up a closed connection'),
          )
      })

      socket.on('message', (raw: Buffer) => {
        void handleMessage(raw).catch((error: unknown) => {
          app.log.error({ err: error }, 'error handling a realtime client message')
        })
      })

      async function handleMessage(raw: Buffer): Promise<void> {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw.toString('utf8'))
        } catch {
          send(JSON.stringify({ op: 'error', message: 'invalid JSON' }))
          return
        }

        const result = realtimeClientMessageSchema.safeParse(parsed)
        if (!result.success) {
          send(JSON.stringify({ op: 'error', message: 'invalid message' }))
          return
        }

        if (result.data.op === 'subscribe') {
          const { applied, denied } = await subscriptions.subscribe(
            connectionId,
            userId,
            result.data.channels,
          )
          if (applied.length > 0) send(JSON.stringify({ op: 'subscribed', channels: applied }))
          if (denied.length > 0) {
            send(
              JSON.stringify({
                op: 'error',
                message: `unauthorized channel(s): ${denied.join(', ')}`,
              }),
            )
          }
        } else {
          const removed = await subscriptions.unsubscribe(connectionId, result.data.channels)
          send(JSON.stringify({ op: 'unsubscribed', channels: removed }))
        }
      }
    },
  )
}
