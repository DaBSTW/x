'use client'

import type {
  RealtimeServerEvent,
  RealtimeServerMessage,
  RealtimeSubscribeMessage,
} from '@x/contracts'
import { useEffect, useRef } from 'react'
import { apiClient } from '../api-client'
import { MAX_CONSECUTIVE_TRANSPORT_FAILURES, nextReconnectDelayMs } from '../realtime-backoff'

const WS_GATEWAY_URL = process.env.NEXT_PUBLIC_WS_GATEWAY_URL ?? 'ws://localhost:3002/v1'

export type WebsocketTransportOptions = {
  /** use-realtime-channel.ts's own "which tier is active" gate — false tears the connection down (if any) and does nothing else, the same idle posture `channel === undefined` already has. */
  enabled: boolean
  /**
   * Called once a connection attempt has failed
   * `MAX_CONSECUTIVE_TRANSPORT_FAILURES` times *before ever completing the
   * WebSocket handshake* — the signal that something is actually blocking
   * this transport (a proxy stripping `Upgrade`), not just an ordinary
   * blip a reconnect would ride out. Firing this stops this hook's own
   * retries for the rest of its mount, on the assumption the coordinator
   * will flip `enabled` to false in response.
   */
  onExhausted: () => void
}

/**
 * The original WebSocket-only connection this hook used to be, unchanged
 * in its actual protocol handling — extracted so use-realtime-channel.ts
 * can run it alongside the SSE and polling fallbacks below it
 * (ROADMAP.md 2.2), switching between them via `enabled` instead of each
 * tier being a separate hook the coordinator would otherwise have to call
 * conditionally (breaking the rules of hooks).
 */
export function useWebsocketTransport(
  channel: string | undefined,
  onEvent: (event: RealtimeServerEvent) => void,
  options: WebsocketTransportOptions,
): void {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const onExhaustedRef = useRef(options.onExhausted)
  onExhaustedRef.current = options.onExhausted

  useEffect(() => {
    if (!channel || !options.enabled) return
    const activeChannel = channel

    let cancelled = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let consecutiveFailures = 0
    let exhausted = false
    let lastEventId: string | undefined

    function scheduleReconnect(): void {
      if (cancelled || exhausted) return
      const delay = nextReconnectDelayMs(attempt)
      attempt += 1
      reconnectTimer = setTimeout(() => void connect(), delay)
    }

    async function connect(): Promise<void> {
      if (cancelled || exhausted) return
      const { data, error } = await apiClient.POST('/realtime/ticket')
      if (cancelled) return
      if (error) {
        scheduleReconnect()
        return
      }

      let openedThisAttempt = false
      const ws = new WebSocket(`${WS_GATEWAY_URL}?ticket=${encodeURIComponent(data.data.ticket)}`)
      socket = ws

      ws.onopen = () => {
        openedThisAttempt = true
        attempt = 0
        consecutiveFailures = 0
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
        if (cancelled) return
        if (!openedThisAttempt) {
          consecutiveFailures += 1
          if (consecutiveFailures >= MAX_CONSECUTIVE_TRANSPORT_FAILURES) {
            exhausted = true
            onExhaustedRef.current()
            return
          }
        }
        scheduleReconnect()
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
  }, [channel, options.enabled])
}
