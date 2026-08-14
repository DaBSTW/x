import { realtimeChannelSchema } from '@x/contracts'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import type { ConnectionRegistry } from './connection-registry.js'
import type { DeliveryHub } from './delivery-hub.js'
import type { RealtimeRepository } from './realtime.repository.js'
import { createSubscriptionHandler } from './subscription-handler.js'
import { createTicketPreHandler } from './ticket-auth.js'

export type SsePluginOptions = {
  redis: Redis
  subscriber: Redis
  registry: ConnectionRegistry
  repository: RealtimeRepository
  hub: DeliveryHub
  corsOrigin: string
  heartbeatIntervalMs: number
  backpressureLimitBytes: number
}

/**
 * `GET /v1/sse?ticket=…&channel=…` — ROADMAP.md 2.2's SSE fallback for a
 * client that can't hold a WebSocket open at all (some corporate proxies
 * strip the `Upgrade` header). Reuses every piece of `/v1`'s own
 * infrastructure — the ticket, `createSubscriptionHandler`'s authorize
 * +subscribe+replay, and the shared `DeliveryHub`'s dedup guard — the only
 * real difference is the transport itself and one consequence of SSE's
 * one-way nature: **exactly one channel per connection**, not
 * gateway.plugin.ts's array of channels sent after connecting. SSE has no
 * post-connection client→server message to carry a *second* `subscribe`
 * over, so every channel would need its own `since` cursor threaded through
 * a *single* stream's `Last-Event-ID`/id: framing — workable for one
 * channel, ambiguous for several sharing one cursor (a newer id from
 * channel A would wrongly gate channel B's replay). apps/web's own
 * use-realtime-channel.ts already opens one connection per channel even
 * over WebSocket (nothing today multiplexes several channels on one
 * socket) — so this isn't a capability this fallback actually gives up in
 * practice, only one it declines to build for a case nothing needs yet.
 */
export async function registerSseRoute(
  app: FastifyInstance,
  options: SsePluginOptions,
): Promise<void> {
  const {
    redis,
    subscriber,
    registry,
    repository,
    hub,
    corsOrigin,
    heartbeatIntervalMs,
    backpressureLimitBytes,
  } = options

  const subscriptions = createSubscriptionHandler({ registry, repository, subscriber, redis })
  let nextConnectionId = 0

  app.get(
    '/v1/sse',
    { preHandler: [createTicketPreHandler(redis, corsOrigin)] },
    async (request, reply) => {
      if (request.realtimeUserId === undefined) {
        // Unreachable — see gateway.plugin.ts's identical comment on why
        // this can't actually happen, kept for the same CODESTYLE.md §6
        // reason (no `!`, fail loudly instead of assuming).
        return reply
          .code(500)
          .send({ error: { code: 'INTERNAL_ERROR', message: 'internal error' } })
      }
      const userId: bigint = request.realtimeUserId

      const query = request.query as Record<string, unknown>
      const channelResult = realtimeChannelSchema.safeParse(query.channel)
      if (!channelResult.success) {
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION_ERROR', message: 'missing or invalid channel' } })
      }
      const channel = channelResult.data

      // The query param takes priority when both are present: it's what
      // this app's own client (apps/web's use-sse-transport.ts) actually
      // sends, tracking `since` itself for the exact same manual
      // backoff+jitter policy the WebSocket fallback uses (realtime-
      // backoff.ts) instead of leaning on EventSource's own fixed-interval
      // auto-retry. The header is still honored on its own for any other
      // client that *does* rely on native EventSource reconnection —
      // that's what the browser populates `Last-Event-ID` with, standard
      // SSE behavior this route shouldn't quietly ignore just because its
      // own client doesn't use it.
      const sinceQuery = typeof query.since === 'string' ? query.since : undefined
      const lastEventIdHeader = request.headers['last-event-id']
      const since =
        sinceQuery ?? (typeof lastEventIdHeader === 'string' ? lastEventIdHeader : undefined)

      const connectionId = `sse-${nextConnectionId++}`

      // Authorize — and collect any replay — *before* opening the stream.
      // A real advantage over the WebSocket path: there, a denied
      // subscribe can only ever be an `{op: "error"}` frame sent after
      // the upgrade already happened, because the channel isn't known
      // until a post-connect message names it. Here the channel is a query
      // param, known before any response is sent at all, so a denial gets
      // a real HTTP 403 and the SSE stream never opens.
      const { applied, replay } = await subscriptions.subscribe(
        connectionId,
        userId,
        [channel],
        since !== undefined ? { [channel]: since } : undefined,
      )
      if (applied.length === 0) {
        return reply
          .code(403)
          .send({ error: { code: 'FORBIDDEN', message: 'not authorized for this channel' } })
      }

      // From here on, this response is ours — Fastify's normal
      // send/serialize lifecycle never touches it again (the standard
      // pattern for a hand-rolled streaming response; see e.g. Fastify's
      // own SSE recipe).
      reply.hijack()
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Told a common reverse-proxy default (nginx) not to buffer this
        // response — buffering would defeat the entire point of a stream.
        'x-accel-buffering': 'no',
        'access-control-allow-origin': corsOrigin,
        vary: 'origin',
      })

      writeFrame(
        reply.raw,
        `data: ${JSON.stringify({ op: 'subscribed', channels: [channel] })}\n\n`,
        app.log,
      )

      hub.register(connectionId, (raw, eventId) => {
        writeFrame(reply.raw, `id: ${eventId}\ndata: ${raw}\n\n`, app.log, backpressureLimitBytes)
      })

      // After the ack, not before — same ordering guarantee as
      // gateway.plugin.ts's own replay loop, and routed through the exact
      // same hub.deliverEvent so its dedup guard covers this path too: a
      // live PUBLISH for one of these same events, arriving mid-replay, is
      // still only ever delivered once.
      for (const { events } of replay) {
        for (const event of events) hub.deliverEvent(connectionId, channel, event.id, event.raw)
      }

      // SSE has no client→server pong to answer, unlike gateway.plugin.ts's
      // heartbeat — a dead peer is instead only ever discovered by this
      // comment write itself eventually failing (Node doesn't otherwise
      // notice a half-open TCP connection). Reuses the same interval
      // config as the WS path; there's no equivalent "timeout" half since
      // there's nothing for a client to answer within one.
      const heartbeat = setInterval(() => {
        writeFrame(reply.raw, ': heartbeat\n\n', app.log, backpressureLimitBytes)
      }, heartbeatIntervalMs)

      request.raw.on('close', () => {
        clearInterval(heartbeat)
        hub.unregister(connectionId)
        void subscriptions
          .disconnect(connectionId)
          .catch((error: unknown) =>
            app.log.error(
              { err: error, connectionId },
              'failed to clean up a closed SSE connection',
            ),
          )
      })
    },
  )
}

/** Writes one SSE frame, closing the connection instead if its write queue is already backed up — the same backpressure rule gateway.plugin.ts's sendRaw applies to WebSocket, translated to this transport's own signal (`writableLength`, not `bufferedAmount`). `limitBytes` is optional: the initial "subscribed" ack always gets written regardless, since backpressure can't have built up on a connection that's still on its very first write. */
function writeFrame(
  raw: { write: (chunk: string) => boolean; destroy: () => void; writableLength: number },
  frame: string,
  logger: FastifyBaseLogger,
  limitBytes?: number,
): void {
  if (limitBytes !== undefined && raw.writableLength > limitBytes) {
    logger.warn(
      { bufferedBytes: raw.writableLength },
      'closing an SSE connection over the backpressure limit',
    )
    raw.destroy()
    return
  }
  raw.write(frame)
}
