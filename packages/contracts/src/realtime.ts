import { z } from 'zod'

// POST /realtime/ticket (ROADMAP.md 2.2, SPECS.md §8.1) — a one-time-use
// ticket so the JWT itself never travels in a WebSocket URL's query string.
export const realtimeTicketResponseSchema = z.object({
  data: z.object({
    ticket: z.string(),
    expiresIn: z.number().int().positive(),
  }),
})
export type RealtimeTicketResponse = z.infer<typeof realtimeTicketResponseSchema>

// --- WS wire protocol (SPECS.md §8.1/§8.2) ---------------------------------
// These never go through fastify-type-provider-zod (the connection isn't a
// normal HTTP request/response) — shared here purely so apps/ws-gateway and
// apps/web's client agree on the exact shape without importing each other
// (CODESTYLE.md §7's apps-never-import-apps rule).

/** `user:{id}`, `conv:{id}`, `post:{id}` or `timeline:{id}` — SPECS.md §8.2. */
export const realtimeChannelSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^(user|conv|post|timeline):[0-9]+$/, 'unrecognized channel format')

export const realtimeSubscribeMessageSchema = z.object({
  op: z.literal('subscribe'),
  channels: z.array(realtimeChannelSchema).min(1).max(20),
  // Redis Stream entry id per channel already being re-subscribed to after
  // a drop (SPECS.md §8.3: "al reconectar, el cliente envía last_event_id").
  // Omitted, or a channel missing from the map, means "just subscribe
  // live" — the normal first-time-connecting case, nothing to replay.
  since: z.record(realtimeChannelSchema, z.string()).optional(),
})
export type RealtimeSubscribeMessage = z.infer<typeof realtimeSubscribeMessageSchema>

export const realtimeUnsubscribeMessageSchema = z.object({
  op: z.literal('unsubscribe'),
  channels: z.array(realtimeChannelSchema).min(1).max(20),
})
export type RealtimeUnsubscribeMessage = z.infer<typeof realtimeUnsubscribeMessageSchema>

/** Every message a client may send over the socket, discriminated by `op`. */
export const realtimeClientMessageSchema = z.discriminatedUnion('op', [
  realtimeSubscribeMessageSchema,
  realtimeUnsubscribeMessageSchema,
])
export type RealtimeClientMessage = z.infer<typeof realtimeClientMessageSchema>

/**
 * Server → client acknowledgement, one per successfully-processed
 * subscribe/unsubscribe request — lets a client (and this checkpoint's own
 * tests) tell "applied" apart from "silently dropped" without racing the
 * first real event on the channel.
 */
export const realtimeSubscribedAckSchema = z.object({
  op: z.literal('subscribed'),
  channels: z.array(z.string()),
})
export type RealtimeSubscribedAck = z.infer<typeof realtimeSubscribedAckSchema>

export const realtimeUnsubscribedAckSchema = z.object({
  op: z.literal('unsubscribed'),
  channels: z.array(z.string()),
})
export type RealtimeUnsubscribedAck = z.infer<typeof realtimeUnsubscribedAckSchema>

export const realtimeErrorMessageSchema = z.object({
  op: z.literal('error'),
  message: z.string(),
})
export type RealtimeErrorMessage = z.infer<typeof realtimeErrorMessageSchema>

/**
 * Server → client event envelope, published on any of SPECS.md §8.2's
 * channels. `eventId` is the Redis Stream entry id the event was also
 * `XADD`ed under — what a client persists and later sends back as `since`
 * (above) to replay whatever it missed while disconnected.
 */
export const realtimeServerEventSchema = z.object({
  op: z.literal('event'),
  channel: z.string(),
  event: z.string(),
  data: z.unknown(),
  eventId: z.string(),
})
export type RealtimeServerEvent = z.infer<typeof realtimeServerEventSchema>

export const realtimeServerMessageSchema = z.discriminatedUnion('op', [
  realtimeSubscribedAckSchema,
  realtimeUnsubscribedAckSchema,
  realtimeErrorMessageSchema,
  realtimeServerEventSchema,
])
export type RealtimeServerMessage = z.infer<typeof realtimeServerMessageSchema>

// --- GET /realtime/poll (ROADMAP.md 2.2's "último caso, polling
// adaptativo") -------------------------------------------------------------
// A last-resort fallback for a client that can't hold either a WebSocket
// (apps/ws-gateway's `/v1`) or an SSE stream (`/v1/sse`) open at all — some
// corporate proxies block both. Plain JWT-authenticated REST, deliberately
// *not* the ticket scheme those two use: a ticket exists so a bearer token
// never sits in a URL a proxy/access log records (SPECS.md §8.1), but a
// polling GET already carries its token in an Authorization header like
// every other REST call in this API, so that risk never applies here.

export const realtimePollQuerySchema = z.object({
  channel: realtimeChannelSchema,
  // Omitted on a client's first-ever poll for this channel — same "just
  // tell me where the tip of the stream is, nothing to replay yet"
  // semantics as the WS/SSE paths' own first subscribe.
  since: z.string().optional(),
})
export type RealtimePollQuery = z.infer<typeof realtimePollQuerySchema>

/** One missed event — `channel` isn't repeated per item since it's already the query's own `channel`, unlike realtimeServerEventSchema's WS/SSE envelope which multiplexes several channels over one connection. */
export const realtimePolledEventSchema = z.object({
  eventId: z.string(),
  event: z.string(),
  data: z.unknown(),
})
export type RealtimePolledEvent = z.infer<typeof realtimePolledEventSchema>

export const realtimePollResponseSchema = z.object({
  data: z.object({
    events: z.array(realtimePolledEventSchema),
    // The stream id to send back as `since` on the *next* poll — echoes the
    // last item of `events` when there were any, otherwise the previous
    // `since` un-advanced, or null when the channel has never had a single
    // event published on it (nothing to advance to yet).
    latestEventId: z.string().nullable(),
  }),
})
export type RealtimePollResponse = z.infer<typeof realtimePollResponseSchema>
