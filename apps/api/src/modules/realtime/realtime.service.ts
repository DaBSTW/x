import { generateOpaqueToken, realtimeTicketKey, sha256Hex } from '@x/utils'
import type { Redis } from 'ioredis'

export type RealtimeService = ReturnType<typeof createRealtimeService>

/**
 * Issues one-time WebSocket connection tickets (ROADMAP.md 2.2, SPECS.md
 * §8.1) — the JWT itself never travels in `wss://.../v1?ticket=…`'s query
 * string, where it would end up in access logs and browser history instead.
 * apps/ws-gateway redeems the ticket with `GETDEL` on the same Redis key
 * format (`realtimeTicketKey`, `@x/utils` — the two apps can't import each
 * other, CODESTYLE.md §7), which is what actually makes it one-time-use.
 */
export function createRealtimeService(redis: Redis, ticketTtlSeconds: number) {
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
  }
}
