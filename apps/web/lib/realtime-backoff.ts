// SPECS.md §8.3: "Reconexión: backoff exponencial con jitter (1 s → 30 s
// máx.)" — ROADMAP.md 2.2. Reused for three cascading purposes now, all the
// same underlying question ("how long before trying again"): WebSocket
// reconnect delay (use-websocket-transport.ts), SSE reconnect delay
// (use-sse-transport.ts, which manages its own manual reconnect loop
// instead of leaning on EventSource's native fixed-interval auto-retry —
// see that file's own comment on why), and adaptive polling's interval
// (use-polling-transport.ts: reset to attempt 0, i.e. fast, on any poll
// that finds something new; advance on one that doesn't).
const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 30_000
// ±20%: enough to spread out a reconnect storm across many clients so they
// don't all retry in lockstep, without the delay wandering far from the
// exponential curve the spec calls out by name.
const JITTER_RATIO = 0.2

/**
 * Delay before reconnect attempt number `attempt` (0-indexed: the first
 * retry after a drop is `attempt = 0`). `random` is injectable so tests can
 * pin the jitter instead of asserting against a range.
 */
export function nextReconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt)
  const jitter = exponential * JITTER_RATIO * (random() * 2 - 1)
  return Math.max(0, Math.min(MAX_DELAY_MS, exponential + jitter))
}

/**
 * How many consecutive *failed-before-ever-subscribing* attempts a
 * transport (WebSocket, then SSE) tolerates before use-realtime-channel.ts
 * gives up on it for this hook's lifetime and falls back to the next tier
 * — ROADMAP.md 2.2's "fallback a SSE y, en último caso, polling
 * adaptativo." A transport that connects fine and drops later (a normal
 * blip) never counts toward this at all; only one that can't even complete
 * a handshake does, since that's the actual signal a proxy/network is
 * blocking the transport outright rather than a transient disconnect the
 * existing backoff above is already meant to ride out.
 */
export const MAX_CONSECUTIVE_TRANSPORT_FAILURES = 3
