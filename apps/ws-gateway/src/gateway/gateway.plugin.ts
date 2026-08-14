import { realtimeClientMessageSchema } from '@x/contracts'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import type { WebSocket } from 'ws'
import type { ConnectionRegistry } from './connection-registry.js'
import { createDeliveryHub } from './delivery-hub.js'
import type { RealtimeRepository } from './realtime.repository.js'
import { registerSseRoute } from './sse.plugin.js'
import { createSubscriptionHandler } from './subscription-handler.js'
import { createTicketPreHandler } from './ticket-auth.js'

export type GatewayPluginOptions = {
  /** General-purpose connection — ticket redemption (`GETDEL`), stream replay (`XRANGE`). */
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

/**
 * Registers both of this service's realtime routes — `/v1` (WebSocket) and
 * `/v1/sse` (ROADMAP.md 2.2's fallback, sse.plugin.ts) — sharing one
 * `DeliveryHub` between them so a channel with listeners of both protocols
 * on this process still issues exactly one real Redis `SUBSCRIBE`
 * (delivery-hub.ts's own comment on why that has to be a single shared
 * instance, not one per route).
 */
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

  const hub = createDeliveryHub({ registry, subscriber, logger: app.log })
  const subscriptions = createSubscriptionHandler({ registry, repository, subscriber, redis })
  let nextConnectionId = 0

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

      // Prefixed, not a bare counter: this id is also a DeliveryHub key the
      // SSE route (its own, independently-counted `sse-N` ids) shares —
      // without the prefix, a WS connection "0" and an SSE connection "0"
      // in the same process would collide in the hub's and registry's maps.
      const connectionId = `ws-${nextConnectionId++}`
      const send = (message: string) => sendRaw(socket, message, backpressureLimitBytes, app.log)
      hub.register(connectionId, send)

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
        hub.unregister(connectionId)
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
          const { applied, denied, replay } = await subscriptions.subscribe(
            connectionId,
            userId,
            result.data.channels,
            result.data.since,
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
          // After the ack, not before — the client learns "you're
          // subscribed" before backlog starts arriving on top of it.
          for (const { channel, events } of replay) {
            for (const event of events) hub.deliverEvent(connectionId, channel, event.id, event.raw)
          }
        } else {
          const removed = await subscriptions.unsubscribe(connectionId, result.data.channels)
          send(JSON.stringify({ op: 'unsubscribed', channels: removed }))
        }
      }
    },
  )

  await registerSseRoute(app, {
    redis,
    subscriber,
    registry,
    repository,
    hub,
    corsOrigin,
    heartbeatIntervalMs,
    backpressureLimitBytes,
  })
}
