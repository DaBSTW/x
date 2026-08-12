'use client'

import type {
  RealtimeServerEvent,
  RealtimeServerMessage,
  RealtimeSubscribeMessage,
} from '@x/contracts'
import { useEffect, useRef } from 'react'
import { apiClient } from './api-client'
import { nextReconnectDelayMs } from './realtime-backoff'

const WS_GATEWAY_URL = process.env.NEXT_PUBLIC_WS_GATEWAY_URL ?? 'ws://localhost:3002/v1'

/**
 * Connects to apps/ws-gateway (ROADMAP.md 2.2), subscribes to a single
 * channel, and calls `onEvent` for every event delivered on it —
 * reconnecting with exponential backoff + jitter (SPECS.md §8.3) whenever
 * the connection drops, fetching a fresh one-time ticket each time (a used
 * or expired one is rejected outright, ROADMAP.md 2.2's own ticket bullet).
 *
 * `channel` is `undefined` while there's nothing worth subscribing to yet
 * (e.g. the current user hasn't loaded) — the hook stays idle, the same
 * "enabled" convention TanStack Query hooks use elsewhere in this codebase.
 * Not built on TanStack Query itself: this isn't a request/response fetch
 * with a cacheable result, it's a standing connection with a callback.
 */
export function useRealtimeChannel(
  channel: string | undefined,
  onEvent: (event: RealtimeServerEvent) => void,
): void {
  // Ref, not a dependency — a caller passing an inline arrow function
  // shouldn't tear down and reopen the socket on every render.
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!channel) return
    // A `const` re-binding, not just the narrowed parameter: TS only
    // carries `!channel` narrowing into the nested closures below (connect,
    // ws.onopen) reliably through a binding it knows can't be reassigned —
    // needed now that subscribeMessage's type actually gets checked, unlike
    // before this file used `channel` as a bare, uninspected object literal.
    const activeChannel = channel

    let cancelled = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    // Redis Stream entry id of the last event actually delivered on this
    // channel (SPECS.md §8.3) — undefined until the first one arrives, and
    // reset only when `channel` itself changes (a fresh effect run), never
    // by a reconnect. ROADMAP.md 2.2's own note: the gateway's replay
    // machinery (`stream-replay.ts`) has existed and been tested end to end
    // since this section was first built — nothing on this side ever sent
    // `since` back to actually trigger it, so a connection drop silently
    // lost whatever was published while it was down. This is that gap closed.
    let lastEventId: string | undefined

    function scheduleReconnect(): void {
      if (cancelled) return
      const delay = nextReconnectDelayMs(attempt)
      attempt += 1
      reconnectTimer = setTimeout(() => void connect(), delay)
    }

    async function connect(): Promise<void> {
      if (cancelled) return
      const { data, error } = await apiClient.POST('/realtime/ticket')
      if (cancelled) return
      if (error) {
        scheduleReconnect()
        return
      }

      const ws = new WebSocket(`${WS_GATEWAY_URL}?ticket=${encodeURIComponent(data.data.ticket)}`)
      socket = ws

      ws.onopen = () => {
        attempt = 0
        // Omitted on the very first connect (nothing received yet, nothing
        // to replay) — same "just subscribe live" default the schema itself
        // documents (packages/contracts/src/realtime.ts).
        const subscribeMessage: RealtimeSubscribeMessage = {
          op: 'subscribe',
          channels: [activeChannel],
        }
        if (lastEventId !== undefined) subscribeMessage.since = { [activeChannel]: lastEventId }
        ws.send(JSON.stringify(subscribeMessage))
      }
      ws.onmessage = (messageEvent: MessageEvent<string>) => {
        let parsed: RealtimeServerMessage
        try {
          parsed = JSON.parse(messageEvent.data) as RealtimeServerMessage
        } catch {
          return // malformed frame — ignore rather than crash the connection over it
        }
        if (parsed.op === 'event') {
          lastEventId = parsed.eventId
          onEventRef.current(parsed)
        }
      }
      ws.onclose = () => {
        if (!cancelled) scheduleReconnect()
      }
      ws.onerror = () => {
        ws.close()
      }
    }

    void connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [channel])
}
