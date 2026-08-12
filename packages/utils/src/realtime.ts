// Shared between apps/api (issues the ticket, POST /realtime/ticket) and
// apps/ws-gateway (redeems it on connect) — SPECS.md §8.1. The two can never
// import each other (CODESTYLE.md §7's dependency direction), so this Redis
// key format is the only contract between them; a test on each side pins it
// independently against this same helper.
export function realtimeTicketKey(ticketHash: string): string {
  return `realtime:ticket:${ticketHash}`
}

/** SPECS.md §8.1: `{ "ticket": "…", "expires_in": 60 }`. */
export const REALTIME_TICKET_TTL_SECONDS = 60

// Channel name builders (SPECS.md §8.2) — centralized so a future publisher
// (apps/api, apps/workers) and apps/ws-gateway's own subscription
// authorization never drift on the string format independently.
export function userChannel(userId: string | bigint): string {
  return `user:${userId}`
}
export function conversationChannel(conversationId: string | bigint): string {
  return `conv:${conversationId}`
}
export function postChannel(postId: string | bigint): string {
  return `post:${postId}`
}
export function timelineChannel(userId: string | bigint): string {
  return `timeline:${userId}`
}

// Lost-event recovery (SPECS.md §8.3, ROADMAP.md 2.2) — every channel a
// publisher PUBLISHes to also gets XADD'd to this Redis Stream, so a client
// reconnecting with `last_event_id` can replay what it missed instead of
// silently losing it. One stream per channel, not one global stream: a
// reconnect only ever wants to replay the specific channels it was
// subscribed to, and per-channel keys make that a plain `XRANGE`, no
// filtering a shared stream down after the fact.
export function realtimeStreamKey(channel: string): string {
  return `realtime:stream:${channel}`
}

/** SPECS.md §8.3: "retención 5 min." */
export const REALTIME_STREAM_RETENTION_MS = 5 * 60 * 1000

// Stream entry field names — the publisher (apps/workers) writes these via
// XADD, apps/ws-gateway's replay reads them back via XRANGE; centralized
// for the same reason as the key/channel builders above (the two can't
// import each other).
export const REALTIME_STREAM_FIELD_EVENT = 'event'
export const REALTIME_STREAM_FIELD_DATA = 'data'

/** SPECS.md §8.2's `timeline:{id}` badge event name. */
export const POST_AVAILABLE_EVENT = 'post.available'
