// SPECS.md §14.1's anti-stampede bullet: "jitter en TTLs (±10 %)" — shared
// between apps/api (following-cache.ts, idempotency.ts, timeline reads'
// reconstruction) and apps/workers (fan-out's own timeline TTL) so a
// timeline's expiry lands on roughly the same jittered value regardless of
// which of those two call sites last touched it.

/**
 * Applies ±`jitterRatio` random jitter to a base TTL, rounded to the
 * nearest whole second. Many keys seeded around the same moment (e.g. a
 * burst of new followers all warming their timeline within the same
 * second) would otherwise all expire in the same instant and stampede
 * whatever rebuilds them — spreading the actual expiry over a small window
 * turns that into a trickle instead.
 *
 * @throws {RangeError} If `jitterRatio` is outside `[0, 1]` — a value
 * outside that range would let a jittered TTL go negative or more than
 * double the base, neither of which is "jitter" any more.
 */
export function jitterTtlSeconds(baseTtlSeconds: number, jitterRatio = 0.1): number {
  if (jitterRatio < 0 || jitterRatio > 1) {
    throw new RangeError(`jitterRatio must be between 0 and 1, got ${jitterRatio}`)
  }
  const spread = baseTtlSeconds * jitterRatio
  const offset = (Math.random() * 2 - 1) * spread // uniform in [-spread, +spread]
  return Math.max(1, Math.round(baseTtlSeconds + offset))
}
