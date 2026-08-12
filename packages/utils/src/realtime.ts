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
