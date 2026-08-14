'use client'

import type { RealtimeServerEvent } from '@x/contracts'
import { useCallback, useState } from 'react'
import { type RealtimeTier, nextRealtimeTier } from './realtime-transports/realtime-tier'
import { usePollingTransport } from './realtime-transports/use-polling-transport'
import { useSseTransport } from './realtime-transports/use-sse-transport'
import { useWebsocketTransport } from './realtime-transports/use-websocket-transport'

/**
 * Subscribes to a single realtime channel and calls `onEvent` for every
 * event delivered on it, cascading through ROADMAP.md 2.2's three
 * transport tiers in order — WebSocket (apps/ws-gateway's `/v1`), then SSE
 * (`/v1/sse`), then adaptive REST polling (`GET /realtime/poll`) — falling
 * back only once the current tier has failed to even connect
 * `MAX_CONSECUTIVE_TRANSPORT_FAILURES` times in a row (realtime-backoff.ts),
 * never for an ordinary drop-and-reconnect blip a transport's own backoff
 * already rides out on its own.
 *
 * All three transport hooks below are *always* called, every render — each
 * is an inert no-op unless it's the current tier's `enabled: true` (the
 * same "enabled" convention TanStack Query hooks use elsewhere in this
 * codebase). Conditionally calling a *different* one of the three per tier
 * would change how many hooks render across renders, which breaks React's
 * rules of hooks; gating each one's own internal effect instead doesn't.
 *
 * `channel` is `undefined` while there's nothing worth subscribing to yet
 * (e.g. the current user hasn't loaded) — every tier stays idle. A change
 * of `channel` restarts the cascade from `websocket`: whatever made a
 * *previous* channel fall back to a lower tier doesn't necessarily still
 * apply, and a fresh subscription deserves a fresh shot at the best
 * transport rather than inheriting a stale downgrade.
 */
export function useRealtimeChannel(
  channel: string | undefined,
  onEvent: (event: RealtimeServerEvent) => void,
): void {
  const [tier, setTier] = useState<RealtimeTier>('websocket')
  // Resets `tier` the moment `channel` itself changes — React's own
  // documented "adjust state while rendering" pattern (react.dev, "You
  // Might Not Need an Effect" → "Resetting all state when a prop changes")
  // instead of a dedicated useEffect keyed on `channel`: this runs during
  // render, so the very first render of a new channel already uses
  // `websocket`, and there's no extra render-then-effect-then-render pass
  // in between where a stale downgraded tier would briefly apply to a
  // brand new channel.
  const [tierChannel, setTierChannel] = useState(channel)
  if (channel !== tierChannel) {
    setTierChannel(channel)
    setTier('websocket')
  }

  const onWebsocketExhausted = useCallback(() => {
    setTier((current) => (current === 'websocket' ? nextRealtimeTier(current) : current))
  }, [])
  const onSseExhausted = useCallback(() => {
    setTier((current) => (current === 'sse' ? nextRealtimeTier(current) : current))
  }, [])

  useWebsocketTransport(channel, onEvent, {
    enabled: tier === 'websocket',
    onExhausted: onWebsocketExhausted,
  })
  useSseTransport(channel, onEvent, {
    enabled: tier === 'sse',
    onExhausted: onSseExhausted,
  })
  usePollingTransport(channel, onEvent, { enabled: tier === 'polling' })
}
