import { describe, expect, it } from 'vitest'
import { type CandidatePost, detectCoordinatedClusters } from './coordination-detector.js'

const SIMHASH_DISTANCE_THRESHOLD = 10
const MIN_CLUSTER_AUTHORS = 3
const TIMING_WINDOW_MS = 10 * 60 * 1000

function baseOptions(overrides: Partial<Parameters<typeof detectCoordinatedClusters>[1]> = {}) {
  return {
    simhashDistanceThreshold: SIMHASH_DISTANCE_THRESHOLD,
    minClusterAuthors: MIN_CLUSTER_AUTHORS,
    timingWindowMs: TIMING_WINDOW_MS,
    authorIpAddresses: new Map<bigint, string>(),
    ...overrides,
  }
}

function post(
  id: number,
  authorId: number,
  text: string,
  createdAt: Date | string = '2026-08-14T12:00:00Z',
): CandidatePost {
  return {
    id: BigInt(id),
    authorId: BigInt(authorId),
    text,
    createdAt: new Date(createdAt),
  }
}

// A template with three lightly-edited (trailing punctuation/emoji only)
// variants — the classic bot-network evasion pattern. Measured pairwise
// Hamming distance for this exact trio tops out at 6 (well under
// SIMHASH_DISTANCE_THRESHOLD=10) — picked empirically, not assumed: an
// earlier draft of this fixture that varied a *word* instead of only
// trailing punctuation measured 11–14 between some pairs, over threshold,
// which is exactly the "verify, don't assume" lesson simhash's own edit
// sensitivity keeps teaching throughout this checkpoint.
const SPAM_A = 'gana seguidores reales gratis, entra ya'
const SPAM_B = 'gana seguidores reales gratis, entra ya!'
const SPAM_C = 'gana seguidores reales gratis, entra ya 🔥'

// A second near-duplicate template + variants (max pairwise distance 7,
// also measured) — used by the "separates two clusters" test below as its
// second, independent cluster. Measured at least 21 bits from every SPAM_*
// fingerprint, comfortably clear of both this trio's own internal spread
// and the threshold, so the two never merge into one.
const TOPIC_A = 'mi gato durmió todo el día en la ventana de la cocina'
const TOPIC_B = TOPIC_A.replace('cocina', 'sala')
const TOPIC_C = TOPIC_A.replace('ventana', 'terraza')

// Three genuinely unrelated topics (not variants of one another) — measured
// 17–23 bits apart from *each other*, used by the "no shared content" test
// below. Distinct from TOPIC_A/B/C above, which are near-duplicates of one
// another on purpose.
const DIFFERENT_TOPIC_A = 'mi gato durmió todo el día en la ventana de la cocina'
const DIFFERENT_TOPIC_B = 'las elecciones municipales de este año estarán muy reñidas'
const DIFFERENT_TOPIC_C = 'hoy fui al mercado a comprar fruta fresca para la semana'

describe('detectCoordinatedClusters', () => {
  it('returns nothing for an empty candidate list', () => {
    expect(detectCoordinatedClusters([], baseOptions())).toEqual([])
  })

  it('returns nothing when fewer candidates exist than minClusterAuthors', () => {
    const candidates = [post(1, 1, SPAM_A), post(2, 2, SPAM_B)]
    expect(detectCoordinatedClusters(candidates, baseOptions())).toEqual([])
  })

  it('flags a near-duplicate cluster from 3 distinct authors posted within the timing window', () => {
    const candidates = [
      post(1, 1, SPAM_A, '2026-08-14T12:00:00Z'),
      post(2, 2, SPAM_B, '2026-08-14T12:02:00Z'),
      post(3, 3, SPAM_C, '2026-08-14T12:04:00Z'),
    ]
    const clusters = detectCoordinatedClusters(candidates, baseOptions())
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.reason).toBe('timing')
    expect(clusters[0]?.authorIds.sort()).toEqual([1n, 2n, 3n])
    expect(clusters[0]?.postIds.sort()).toEqual([1n, 2n, 3n])
  })

  it('does not flag near-duplicate content spread over hours with no shared IP', () => {
    const candidates = [
      post(1, 1, SPAM_A, '2026-08-14T09:00:00Z'),
      post(2, 2, SPAM_B, '2026-08-14T12:00:00Z'),
      post(3, 3, SPAM_C, '2026-08-14T15:00:00Z'),
    ]
    expect(detectCoordinatedClusters(candidates, baseOptions())).toEqual([])
  })

  it('flags a spread-out cluster anyway when two authors share the same session IP ("huella de red")', () => {
    const candidates = [
      post(1, 1, SPAM_A, '2026-08-14T09:00:00Z'),
      post(2, 2, SPAM_B, '2026-08-14T12:00:00Z'),
      post(3, 3, SPAM_C, '2026-08-14T15:00:00Z'),
    ]
    const authorIpAddresses = new Map([
      [1n, '203.0.113.5'],
      [3n, '203.0.113.5'], // Same IP as author 1n — author 2n's is unknown.
    ])
    const clusters = detectCoordinatedClusters(candidates, baseOptions({ authorIpAddresses }))
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.reason).toBe('network')
  })

  it('reports "timing_and_network" when both signals fire', () => {
    const candidates = [
      post(1, 1, SPAM_A, '2026-08-14T12:00:00Z'),
      post(2, 2, SPAM_B, '2026-08-14T12:01:00Z'),
      post(3, 3, SPAM_C, '2026-08-14T12:02:00Z'),
    ]
    const authorIpAddresses = new Map([
      [1n, '203.0.113.5'],
      [2n, '203.0.113.5'],
    ])
    const clusters = detectCoordinatedClusters(candidates, baseOptions({ authorIpAddresses }))
    expect(clusters[0]?.reason).toBe('timing_and_network')
  })

  it('does not flag the same author repeating themselves — coordination is a multi-account pattern', () => {
    // One author, three near-duplicate posts: only 1 distinct author, below
    // minClusterAuthors regardless of how tight the timing is. (A single
    // account's own repeat-posting is ROADMAP.md 3.3e's new-account limits'
    // job, not this one's.)
    const candidates = [
      post(1, 1, SPAM_A, '2026-08-14T12:00:00Z'),
      post(2, 1, SPAM_B, '2026-08-14T12:01:00Z'),
      post(3, 1, SPAM_C, '2026-08-14T12:02:00Z'),
    ]
    expect(detectCoordinatedClusters(candidates, baseOptions())).toEqual([])
  })

  it('does not flag unrelated content from different authors posted together, however tight the timing', () => {
    const candidates = [
      post(1, 1, DIFFERENT_TOPIC_A, '2026-08-14T12:00:00Z'),
      post(2, 2, DIFFERENT_TOPIC_B, '2026-08-14T12:00:30Z'),
      post(3, 3, DIFFERENT_TOPIC_C, '2026-08-14T12:01:00Z'),
    ]
    const authorIpAddresses = new Map([
      [1n, '203.0.113.5'],
      [2n, '203.0.113.5'],
      [3n, '203.0.113.5'],
    ])
    // Content similarity is the defining signal (this function's own
    // top-of-file comment) — three unrelated accounts sharing an IP and
    // posting seconds apart still isn't "coordination" by this function's
    // rule without near-duplicate content tying them together first.
    expect(detectCoordinatedClusters(candidates, baseOptions({ authorIpAddresses }))).toEqual([])
  })

  it('separates two unrelated clusters instead of merging everything into one', () => {
    const candidates = [
      post(1, 1, SPAM_A, '2026-08-14T12:00:00Z'),
      post(2, 2, SPAM_B, '2026-08-14T12:01:00Z'),
      post(3, 3, SPAM_C, '2026-08-14T12:02:00Z'),
      post(4, 4, TOPIC_A, '2026-08-14T12:00:00Z'),
      post(5, 5, TOPIC_B, '2026-08-14T12:01:00Z'),
      post(6, 6, TOPIC_C, '2026-08-14T12:02:00Z'),
    ]
    const clusters = detectCoordinatedClusters(candidates, baseOptions())
    expect(clusters).toHaveLength(2)
    const postIdSets = clusters.map((cluster) => cluster.postIds.sort().join(','))
    expect(postIdSets).toContain('1,2,3')
    expect(postIdSets).toContain('4,5,6')
  })
})
