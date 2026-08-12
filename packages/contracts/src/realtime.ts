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
