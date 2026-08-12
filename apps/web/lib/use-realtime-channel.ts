'use client'

import type { RealtimeServerEvent, RealtimeServerMessage } from '@x/contracts'
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

    let cancelled = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

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
        ws.send(JSON.stringify({ op: 'subscribe', channels: [channel] }))
      }
      ws.onmessage = (messageEvent: MessageEvent<string>) => {
        let parsed: RealtimeServerMessage
        try {
          parsed = JSON.parse(messageEvent.data) as RealtimeServerMessage
        } catch {
          return // malformed frame — ignore rather than crash the connection over it
        }
        if (parsed.op === 'event') onEventRef.current(parsed)
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
