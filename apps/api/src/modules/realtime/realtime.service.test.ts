import { realtimeTicketKey, sha256Hex } from '@x/utils'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it } from 'vitest'
import { createRealtimeService } from './realtime.service.js'

// Hand-rolled — models only the SET-with-options call issueTicket actually
// issues, same convention as notifications.service.test.ts's createFakeRedis.
function createFakeRedis(): Redis {
  const store = new Map<string, { value: string; ttlSeconds: number }>()
  return {
    async set(key: string, value: string, mode: string, ttlSeconds: number) {
      if (mode !== 'EX') throw new Error(`unexpected SET mode: ${mode}`)
      store.set(key, { value, ttlSeconds })
      return 'OK'
    },
    async get(key: string) {
      return store.get(key)?.value ?? null
    },
    _store: store,
  } as unknown as Redis
}

describe('createRealtimeService', () => {
  let redis: Redis

  beforeEach(() => {
    redis = createFakeRedis()
  })

  it('issues a ticket carrying the given TTL', async () => {
    const service = createRealtimeService(redis, 60)
    const { ticket, expiresIn } = await service.issueTicket(123n)

    expect(ticket).toHaveLength(43) // base64url of 32 random bytes, no padding
    expect(expiresIn).toBe(60)
  })

  it('stores the ticket hashed, never in the clear, under the shared key format', async () => {
    const service = createRealtimeService(redis, 60)
    const { ticket } = await service.issueTicket(456n)

    const key = realtimeTicketKey(sha256Hex(ticket))
    expect(await redis.get(key)).toBe('456')
    // The raw ticket itself was never used as a Redis key or value.
    expect(await redis.get(realtimeTicketKey(ticket))).toBeNull()
  })

  it('issues a different ticket on every call, even for the same user', async () => {
    const service = createRealtimeService(redis, 60)
    const first = await service.issueTicket(123n)
    const second = await service.issueTicket(123n)

    expect(first.ticket).not.toBe(second.ticket)
  })
})
