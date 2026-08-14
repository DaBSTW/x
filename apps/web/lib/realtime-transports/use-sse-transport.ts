'use client'

import type { RealtimeServerEvent } from '@x/contracts'
import { useEffect, useRef } from 'react'
import { apiClient } from '../api-client'
import { MAX_CONSECUTIVE_TRANSPORT_FAILURES, nextReconnectDelayMs } from '../realtime-backoff'
import { deriveSseUrl } from './sse-url'

const SSE_URL = deriveSseUrl(process.env.NEXT_PUBLIC_WS_GATEWAY_URL ?? 'ws://localhost:3002/v1')

export type SseTransportOptions = {
  /** use-realtime-channel.ts's own "which tier is active" gate — same idle-when-false posture as use-websocket-transport.ts. */
  enabled: boolean
  /** Same "N consecutive never-even-opened attempts" signal as use-websocket-transport.ts's own onExhausted — see its doc comment; escalates to polling instead of WebSocket. */
  onExhausted: () => void
}

/**
 * ROADMAP.md 2.2's first fallback tier, for a client whose WebSocket
 * transport (use-websocket-transport.ts) gave up — apps/ws-gateway's
 * `/v1/sse` (sse.plugin.ts) survives some proxies that block a WS
 * `Upgrade` outright but still allow a plain long-lived HTTP response.
 *
 * Deliberately doesn't lean on `EventSource`'s own built-in auto-reconnect
 * — it retries at one fixed interval with no backoff or jitter, and gives
 * this hook no clean way to cap attempts before falling back further.
 * Instead every `onerror` closes the current EventSource and opens a fresh
 * one on the *same* exponential-backoff-with-jitter schedule
 * use-websocket-transport.ts uses (realtime-backoff.ts), tracking `since`
 * itself and sending it as `?since=` on the next attempt's URL — the
 * standard `Last-Event-ID` *request header* only gets set by a browser's
 * own native EventSource retry, which this hook always preempts.
 */
export function useSseTransport(
  channel: string | undefined,
  onEvent: (event: RealtimeServerEvent) => void,
  options: SseTransportOptions,
): void {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const onExhaustedRef = useRef(options.onExhausted)
  onExhaustedRef.current = options.onExhausted

  useEffect(() => {
    if (!channel || !options.enabled) return
    const activeChannel = channel

    let cancelled = false
    let source: EventSource | null = null
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
      const params = new URLSearchParams({ ticket: data.data.ticket, channel: activeChannel })
      if (lastEventId !== undefined) params.set('since', lastEventId)
      const source_ = new EventSource(`${SSE_URL}?${params.toString()}`)
      source = source_

      source_.onopen = () => {
        openedThisAttempt = true
        attempt = 0
        consecutiveFailures = 0
      }
      source_.onmessage = (messageEvent: MessageEvent<string>) => {
        let parsed: RealtimeServerEvent
        try {
          parsed = JSON.parse(messageEvent.data) as RealtimeServerEvent
        } catch {
          return // malformed frame — ignore rather than crash the connection over it
        }
        if (parsed.op === 'event') {
          lastEventId = parsed.eventId
          onEventRef.current(parsed)
        }
      }
      source_.onerror = () => {
        // Always torn down here rather than left to EventSource's own
        // retry — see this hook's doc comment on why.
        source_.close()
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
    }

    void connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      source?.close()
    }
  }, [channel, options.enabled])
}
