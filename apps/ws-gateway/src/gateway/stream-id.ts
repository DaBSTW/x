/**
 * Parses a Redis Stream entry id (`<ms>-<seq>`) into its two numeric parts.
 * `BigInt`, not `Number` — the ms component can exceed
 * `Number.MAX_SAFE_INTEGER`'s precision long before it exceeds Redis's own
 * range.
 */
function parseStreamId(id: string): [bigint, bigint] {
  const [ms, seq] = id.split('-', 2)
  return [BigInt(ms ?? '0'), BigInt(seq ?? '0')]
}

/** True when `a` is strictly newer than `b` — Redis Stream ids sort lexically-numerically, never as plain strings (`"9-0" > "10-0"` as strings, backwards). */
export function isStreamIdNewer(a: string, b: string): boolean {
  const [aMs, aSeq] = parseStreamId(a)
  const [bMs, bSeq] = parseStreamId(b)
  if (aMs !== bMs) return aMs > bMs
  return aSeq > bSeq
}
