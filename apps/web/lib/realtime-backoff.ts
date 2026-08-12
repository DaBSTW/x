// SPECS.md §8.3: "Reconexión: backoff exponencial con jitter (1 s → 30 s
// máx.)" — ROADMAP.md 2.2.
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
