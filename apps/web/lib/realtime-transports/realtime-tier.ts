export type RealtimeTier = 'websocket' | 'sse' | 'polling'

/**
 * ROADMAP.md 2.2's fallback cascade order: WebSocket first, then SSE, then
 * adaptive polling as the last resort — `polling` has nothing further to
 * fall back to, so it maps to itself. A pure lookup, not a class of its
 * own, because use-realtime-channel.ts is the only thing that ever needs
 * to know "what comes after this tier fails."
 */
export function nextRealtimeTier(tier: RealtimeTier): RealtimeTier {
  switch (tier) {
    case 'websocket':
      return 'sse'
    case 'sse':
    case 'polling':
      return 'polling'
  }
}
