const HASH_BITS = 64n
const MASK64 = (1n << HASH_BITS) - 1n

/**
 * FNV-1a — a standard, fast, non-cryptographic hash. SimHash below only
 * needs its output bits to be well-distributed across inputs, not
 * collision-resistant the way a security hash would need to be.
 */
function fnv1a64(text: string): bigint {
  const FNV_OFFSET = 0xcbf29ce484222325n
  const FNV_PRIME = 0x100000001b3n
  let hash = FNV_OFFSET
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = (hash * FNV_PRIME) & MASK64
  }
  return hash
}

/**
 * Character trigrams, not word tokens: robust to the small word-level edits
 * (an inserted emoji, a swapped synonym, reordered hashtags) coordinated
 * spam typically uses to dodge exact-match filters, the way an exact
 * post.text comparison or a word-bag would not be.
 */
function shingles(text: string, size = 3): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (normalized.length <= size) return normalized ? [normalized] : []
  const result: string[] = []
  for (let i = 0; i <= normalized.length - size; i++) {
    result.push(normalized.slice(i, i + size))
  }
  return result
}

/**
 * ROADMAP.md 3.3f / SPECS.md §12.3's "clustering... por SimHash" — a real,
 * standard 64-bit SimHash (Charikar 2002, the same near-duplicate-detection
 * technique behind Google's own web-scale dedup), not a stand-in for
 * anything. Unlike toxicity/spam scoring (../lib/content-classifier.ts, over
 * in apps/api) there's no missing trained model to be honest about here —
 * SimHash *is* the named technique, and it's fully implementable with no
 * external dependency or API key.
 *
 * Near-identical inputs produce fingerprints with a small {@link hammingDistance};
 * unrelated inputs differ in roughly half their bits (weighted bit-voting
 * over shingle hashes is what gives SimHash that locality-sensitive
 * property — it's not just "hash the whole string").
 */
export function simhash(text: string): bigint {
  const weights = new Array<number>(64).fill(0)
  for (const shingle of shingles(text)) {
    const hash = fnv1a64(shingle)
    for (let bit = 0; bit < 64; bit++) {
      const isSet = (hash >> BigInt(bit)) & 1n
      weights[bit] = (weights[bit] ?? 0) + (isSet === 1n ? 1 : -1)
    }
  }
  let result = 0n
  for (let bit = 0; bit < 64; bit++) {
    const weight = weights[bit]
    if (weight !== undefined && weight > 0) result |= 1n << BigInt(bit)
  }
  return result
}

/**
 * Number of differing bits between two SimHash fingerprints. Expressed as a
 * distance (0 = identical) rather than a similarity score so a threshold
 * reads as "at most N bits differ" — coordination-detector.ts's own
 * `simhashDistanceThreshold`.
 */
export function hammingDistance(a: bigint, b: bigint): number {
  let xor = (a ^ b) & MASK64
  let count = 0
  while (xor > 0n) {
    count += Number(xor & 1n)
    xor >>= 1n
  }
  return count
}
