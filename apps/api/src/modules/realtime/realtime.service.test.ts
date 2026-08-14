import {
  REALTIME_STREAM_FIELD_DATA,
  REALTIME_STREAM_FIELD_EVENT,
  realtimeStreamKey,
  realtimeTicketKey,
  sha256Hex,
} from '@x/utils'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRealtimeService } from './realtime.service.js'

type StreamEntry = [string, string[]]

// Hand-rolled — models only the handful of calls this file's tests actually
// exercise (SET-with-options, XRANGE, XREVRANGE), same convention as
// notifications.service.test.ts's createFakeRedis.
function createFakeRedis() {
  const store = new Map<string, { value: string; ttlSeconds: number }>()
  const streams = new Map<string, StreamEntry[]>()

  return {
    store,
    streams,
    redis: {
      async set(key: string, value: string, mode: string, ttlSeconds: number) {
        if (mode !== 'EX') throw new Error(`unexpected SET mode: ${mode}`)
        store.set(key, { value, ttlSeconds })
        return 'OK'
      },
      async get(key: string) {
        return store.get(key)?.value ?? null
      },
      async xrange(key: string, start: string, _end: string) {
        const entries = streams.get(key) ?? []
        if (start === '-') return entries
        const sinceId = start.replace(/^\(/, '')
        const sinceIndex = entries.findIndex(([id]) => id === sinceId)
        return sinceIndex === -1 ? entries : entries.slice(sinceIndex + 1)
      },
      async xrevrange(key: string, _start: string, _end: string) {
        const entries = streams.get(key) ?? []
        return entries.length > 0 ? [entries[entries.length - 1] as StreamEntry] : []
      },
    } as unknown as Redis,
  }
}

function seedEvent(
  streams: Map<string, StreamEntry[]>,
  channel: string,
  id: string,
  event: string,
  data: unknown,
): void {
  const key = realtimeStreamKey(channel)
  const entries = streams.get(key) ?? []
  entries.push([
    id,
    [REALTIME_STREAM_FIELD_EVENT, event, REALTIME_STREAM_FIELD_DATA, JSON.stringify(data)],
  ])
  streams.set(key, entries)
}

describe('createRealtimeService', () => {
  let fake: ReturnType<typeof createFakeRedis>
  let isMember: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fake = createFakeRedis()
    isMember = vi.fn().mockResolvedValue(false)
  })

  function service() {
    return createRealtimeService(fake.redis, 60, { conversationMembership: { isMember } })
  }

  describe('issueTicket', () => {
    it('issues a ticket carrying the given TTL', async () => {
      const { ticket, expiresIn } = await service().issueTicket(123n)

      expect(ticket).toHaveLength(43) // base64url of 32 random bytes, no padding
      expect(expiresIn).toBe(60)
    })

    it('stores the ticket hashed, never in the clear, under the shared key format', async () => {
      const { ticket } = await service().issueTicket(456n)

      const key = realtimeTicketKey(sha256Hex(ticket))
      expect(fake.store.get(key)?.value).toBe('456')
      expect(fake.store.has(realtimeTicketKey(ticket))).toBe(false)
    })

    it('issues a different ticket on every call, even for the same user', async () => {
      const s = service()
      const first = await s.issueTicket(123n)
      const second = await s.issueTicket(123n)

      expect(first.ticket).not.toBe(second.ticket)
    })
  })

  describe('pollChannel', () => {
    it("denies a user:{id} channel that isn't the caller's own", async () => {
      const outcome = await service().pollChannel(1n, 'user:2')
      expect(outcome).toEqual({ allowed: false })
    })

    it('denies a conv:{id} channel the caller is not a member of', async () => {
      isMember.mockResolvedValue(false)
      const outcome = await service().pollChannel(1n, 'conv:9')
      expect(outcome).toEqual({ allowed: false })
      expect(isMember).toHaveBeenCalledWith(9n, 1n)
    })

    it('returns a null baseline cursor for a channel that has never had an event', async () => {
      const outcome = await service().pollChannel(1n, 'user:1')
      expect(outcome).toEqual({ allowed: true, events: [], latestEventId: null })
    })

    it('returns the tip id with no events on a first poll of a non-empty channel', async () => {
      seedEvent(fake.streams, 'user:1', '1000-0', 'notification.new', { id: 'a' })
      seedEvent(fake.streams, 'user:1', '2000-0', 'notification.new', { id: 'b' })

      const outcome = await service().pollChannel(1n, 'user:1')
      expect(outcome).toEqual({ allowed: true, events: [], latestEventId: '2000-0' })
    })

    it('returns only events strictly after `since`, with an advanced cursor', async () => {
      seedEvent(fake.streams, 'user:1', '1000-0', 'notification.new', { id: 'a' })
      seedEvent(fake.streams, 'user:1', '2000-0', 'notification.new', { id: 'b' })
      seedEvent(fake.streams, 'user:1', '3000-0', 'notification.new', { id: 'c' })

      const outcome = await service().pollChannel(1n, 'user:1', '1000-0')
      expect(outcome).toEqual({
        allowed: true,
        events: [
          { eventId: '2000-0', event: 'notification.new', data: { id: 'b' } },
          { eventId: '3000-0', event: 'notification.new', data: { id: 'c' } },
        ],
        latestEventId: '3000-0',
      })
    })

    it('echoes `since` back unadvanced when nothing new has been published', async () => {
      seedEvent(fake.streams, 'user:1', '1000-0', 'notification.new', { id: 'a' })

      const outcome = await service().pollChannel(1n, 'user:1', '1000-0')
      expect(outcome).toEqual({ allowed: true, events: [], latestEventId: '1000-0' })
    })
  })
})
