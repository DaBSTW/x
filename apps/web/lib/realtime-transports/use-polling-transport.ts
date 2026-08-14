'use client'

import type { RealtimeServerEvent } from '@x/contracts'
import { useEffect, useRef } from 'react'
import { apiClient } from '../api-client'
import { nextReconnectDelayMs } from '../realtime-backoff'

export type PollingTransportOptions = {
  /** use-realtime-channel.ts's own "which tier is active" gate — same idle-when-false posture as the other two transports. */
  enabled: boolean
}

/**
 * ROADMAP.md 2.2's last-resort fallback — GET /realtime/poll on an
 * activity-adaptive interval, for a client that can hold open neither a
 * WebSocket (use-websocket-transport.ts) nor an SSE connection
 * (use-sse-transport.ts) at all. Reuses the exact same
 * exponential-backoff-with-jitter curve those two use for *reconnection*
 * (realtime-backoff.ts) for a related but different purpose here — the
 * delay *between polls*: a poll that finds nothing new advances it,
 * backing a quiet channel off toward the 30s ceiling; a poll that *does*
 * find something new resets to attempt 0, polling again soon in case more
 * is on the way. There's no further tier below this one to escalate to on
 * exhaustion, so unlike the two transports above it, there's no
 * `onExhausted` here.
 */
export function usePollingTransport(
  channel: string | undefined,
  onEvent: (event: RealtimeServerEvent) => void,
  options: PollingTransportOptions,
): void {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!channel || !options.enabled) return
    const activeChannel = channel

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    // Undefined only until the very first poll resolves — that first call
    // carries no `since` at all (establishing a baseline cursor, same "live
    // only, nothing to replay yet" first-connect default the WS/SSE
    // transports get from an omitted `since`), not "the channel went quiet".
    let since: string | undefined

    function scheduleNextPoll(): void {
      if (cancelled) return
      const delay = nextReconnectDelayMs(attempt)
      timer = setTimeout(() => void poll(), delay)
    }

    async function poll(): Promise<void> {
      if (cancelled) return
      const isBaseline = since === undefined
      const query: { channel: string; since?: string } = { channel: activeChannel }
      if (since !== undefined) query.since = since

      const { data, error } = await apiClient.GET('/realtime/poll', { params: { query } })
      if (cancelled) return
      if (error) {
        attempt += 1
        scheduleNextPoll()
        return
      }

      if (data.data.latestEventId !== null) since = data.data.latestEventId
      if (data.data.events.length > 0) {
        attempt = 0
        for (const event of data.data.events) {
          onEventRef.current({
            op: 'event',
            channel: activeChannel,
            event: event.event,
            data: event.data,
            eventId: event.eventId,
          })
        }
      } else if (!isBaseline) {
        attempt += 1
      }
      scheduleNextPoll()
    }

    void poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [channel, options.enabled])
}
