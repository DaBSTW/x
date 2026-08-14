import { generateOpaqueToken, realtimeTicketKey, sha256Hex } from '@x/utils'
import type { Redis } from 'ioredis'
import { type ChannelAuthorizationDeps, authorizeChannel } from './channel-authorization.js'
import { type PolledEvent, latestStreamEntryId, replayMissedEvents } from './stream-replay.js'

export type RealtimeService = ReturnType<typeof createRealtimeService>

export type PollOutcome =
  | { allowed: true; events: PolledEvent[]; latestEventId: string | null }
  | { allowed: false }

/**
 * Issues one-time WebSocket connection tickets (ROADMAP.md 2.2, SPECS.md
 * §8.1) — the JWT itself never travels in `wss://.../v1?ticket=…`'s query
 * string, where it would end up in access logs and browser history instead.
 * apps/ws-gateway redeems the ticket with `GETDEL` on the same Redis key
 * format (`realtimeTicketKey`, `@x/utils` — the two apps can't import each
 * other, CODESTYLE.md §7), which is what actually makes it one-time-use.
 *
 * Also backs GET /realtime/poll — ROADMAP.md 2.2's "último caso, polling
 * adaptativo" fallback for a client that can't hold a WebSocket or an SSE
 * stream open at all. That path is plain JWT REST, not ticket-based (see
 * realtime.ts's own comment on why), so it's a method here rather than
 * anything issued/redeemed.
 */
export function createRealtimeService(
  redis: Redis,
  ticketTtlSeconds: number,
  deps: ChannelAuthorizationDeps,
) {
  return {
    async issueTicket(userId: bigint): Promise<{ ticket: string; expiresIn: number }> {
      // Hashed at rest, same posture as refresh/verification tokens
      // (@x/utils' tokens.ts) — the raw value is only ever handed to the
      // one client it was issued for.
      const ticket = generateOpaqueToken()
      await redis.set(
        realtimeTicketKey(sha256Hex(ticket)),
        userId.toString(),
        'EX',
        ticketTtlSeconds,
      )
      return { ticket, expiresIn: ticketTtlSeconds }
    },

    async pollChannel(userId: bigint, channel: string, since?: string): Promise<PollOutcome> {
      const allowed = await authorizeChannel(channel, userId, deps)
      if (!allowed) return { allowed: false }

      if (since === undefined) {
        // First-ever poll for this channel: establish a baseline cursor,
        // no backfill — same "live only" default a first WS/SSE subscribe
        // gets (see stream-replay.ts's own comment).
        const latestEventId = await latestStreamEntryId(redis, channel)
        return { allowed: true, events: [], latestEventId }
      }

      const events = await replayMissedEvents(redis, channel, since)
      const lastEvent = events.at(-1)
      // Nothing new: echo `since` back unadvanced rather than null, so the
      // client's next poll keeps the same cursor instead of losing it.
      const latestEventId = lastEvent ? lastEvent.eventId : since
      return { allowed: true, events, latestEventId }
    },
  }
}
