import { hammingDistance, simhash } from './simhash.js'

export type CandidatePost = {
  id: bigint
  authorId: bigint
  text: string
  createdAt: Date
}

export type CoordinationReason = 'timing' | 'network' | 'timing_and_network'

export type CoordinationCluster = {
  postIds: bigint[]
  authorIds: bigint[]
  reason: CoordinationReason
}

export type DetectCoordinationOptions = {
  /** Max Hamming distance (out of 64 bits) for two posts to count as near-duplicate content — simhash.test.ts's own probes are this constant's empirical basis, coordination-sweep.worker.ts's own comment has the measured numbers. */
  simhashDistanceThreshold: number
  /** SPECS.md never names a number — this checkpoint's own call, same posture as reportCategory's own comment on the same question for its set of categories. Below this, near-duplicate content from a couple of accounts reads as "the same meme organically reposted", not coordination. */
  minClusterAuthors: number
  /** How tight the cluster's createdAt spread has to be to count as the "timing" signal. */
  timingWindowMs: number
  /** Each author's most-recently-seen session IP, when known (coordination.repository.ts's own findLatestIpAddresses) — SPECS.md §12.3's "huella de red", simplified to exact-IP-match. Subnet/ASN-level fingerprinting would need real IP-geolocation data this environment doesn't have, the same honest gap 2.7's NSFW image classification already documents for a different signal. */
  authorIpAddresses: Map<bigint, string>
}

/**
 * ROADMAP.md 3.3f / SPECS.md §12.3's "clustering de cuentas por similitud de
 * contenido (SimHash), timing y huella de red" — SimHash forms the
 * candidate clusters (content similarity is the defining signal); timing
 * and network fingerprint are corroborating evidence that turns "a bunch of
 * unrelated accounts happened to post something similar" into "probably
 * coordinated" — a cluster only comes out of this function if at least one
 * of the two fires, never on content similarity alone (SPECS.md's own
 * example of *legitimate* near-duplicate content — many accounts quoting
 * the same news headline, meme, or trending phrase within the same hour —
 * is exactly what a content-only rule would over-flag).
 *
 * Clustering is single-linkage (union-find over every pairwise distance at
 * or under the threshold, i.e. connected components) — the standard way
 * SimHash-based near-duplicate detection is done in practice, but it can
 * chain: A~B and B~C close enough to union doesn't require A~C to also be
 * close. Accepted here the same way it's accepted in the literature this
 * technique comes from, not treated as a bug.
 */
export function detectCoordinatedClusters(
  candidates: CandidatePost[],
  options: DetectCoordinationOptions,
): CoordinationCluster[] {
  if (candidates.length < options.minClusterAuthors) return []

  const hashes = candidates.map((post) => simhash(post.text))

  const parent = new Map<bigint, bigint>()
  for (const post of candidates) parent.set(post.id, post.id)

  function find(id: bigint): bigint {
    let root = id
    while (true) {
      const next = parent.get(root)
      if (next === undefined || next === root) break
      root = next
    }
    // Path compression — flatten every visited node straight to the root
    // so the next find() on any of them is O(1).
    let current = id
    while (current !== root) {
      const next = parent.get(current)
      if (next === undefined) break
      parent.set(current, root)
      current = next
    }
    return root
  }

  function union(a: bigint, b: bigint): void {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootA, rootB)
  }

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const postI = candidates[i]
      const postJ = candidates[j]
      const hashI = hashes[i]
      const hashJ = hashes[j]
      if (
        postI === undefined ||
        postJ === undefined ||
        hashI === undefined ||
        hashJ === undefined
      ) {
        continue
      }
      if (hammingDistance(hashI, hashJ) <= options.simhashDistanceThreshold) {
        union(postI.id, postJ.id)
      }
    }
  }

  const groups = new Map<bigint, CandidatePost[]>()
  for (const post of candidates) {
    const root = find(post.id)
    const group = groups.get(root)
    if (group) group.push(post)
    else groups.set(root, [post])
  }

  const clusters: CoordinationCluster[] = []
  for (const group of groups.values()) {
    const authorIds = [...new Set(group.map((post) => post.authorId))]
    if (authorIds.length < options.minClusterAuthors) continue

    const timestamps = group.map((post) => post.createdAt.getTime())
    const spreadMs = Math.max(...timestamps) - Math.min(...timestamps)
    const timingMatched = spreadMs <= options.timingWindowMs

    const ips = authorIds
      .map((authorId) => options.authorIpAddresses.get(authorId))
      .filter((ip): ip is string => ip !== undefined)
    const networkMatched = new Set(ips).size < ips.length

    if (!timingMatched && !networkMatched) continue

    const reason: CoordinationReason =
      timingMatched && networkMatched ? 'timing_and_network' : timingMatched ? 'timing' : 'network'

    clusters.push({
      postIds: group.map((post) => post.id),
      authorIds,
      reason,
    })
  }

  return clusters
}
