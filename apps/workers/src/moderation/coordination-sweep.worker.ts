import type { Redis } from 'ioredis'
import {
  type CoordinationCluster,
  type CoordinationReason,
  detectCoordinatedClusters,
} from './coordination-detector.js'
import type { CoordinationRepository } from './coordination.repository.js'

// simhash.test.ts's own probes are the empirical basis for this number:
// real lightly-edited near-duplicate pairs measured 0–10 bits apart, real
// unrelated pairs measured 11+ — 10 is the highest value that still keeps
// every measured near-duplicate pair on the "match" side.
const SIMHASH_DISTANCE_THRESHOLD = 10

// SPECS.md never names a number (reportCategory's own schema comment
// already makes the same point for its category set) — 2 accounts posting
// similar content close together is common and mostly benign (two friends
// reacting to the same news); 3 is this checkpoint's own floor for calling
// it coordination.
const MIN_CLUSTER_AUTHORS = 3

// How tight a cluster's createdAt spread has to be to count as the
// "timing" signal on its own.
const TIMING_WINDOW_MS = 10 * 60 * 1000

// How far back each sweep tick looks for candidate posts. Bounded on
// purpose — coordination.repository.ts's own findRecentPosts comment has
// the scaling caveat this window is the honest, simple side of.
const SWEEP_LOOKBACK_MS = 60 * 60 * 1000

// How often the sweep itself runs — slower than counters.flush-worker.ts's
// 5s (that one drains a small Redis batch; this one re-scans and
// re-compares up to an hour of posts pairwise each tick, real but bounded
// work that doesn't need sub-minute freshness the way counters do).
const SWEEP_INTERVAL_MS = 5 * 60 * 1000

// Outlives SWEEP_LOOKBACK_MS by a wide margin so a post already flagged
// can't be re-flagged on a later tick while it's still inside the lookback
// window — same "claim once, TTL longer than the thing it's guarding
// against" posture as kafka-consumer.ts's own idempotency key.
const FLAGGED_TTL_SECONDS = 24 * 60 * 60

// A cluster's priority is size-driven (more distinct accounts posting the
// same content is a stronger signal than three) plus a flat bonus for
// having *both* corroborating signals, not just one — same additive,
// explainable style as moderation.service.ts's own createReport priority,
// over in apps/api.
const CLUSTER_SIZE_PRIORITY_CAP = 10

function coordinationFlaggedKey(postId: bigint): string {
  return `coordination:flagged:${postId}`
}

function computeClusterPriority(authorCount: number, reason: CoordinationReason): number {
  const sizeComponent = Math.min(authorCount / CLUSTER_SIZE_PRIORITY_CAP, 1) * 70
  const signalBonus = reason === 'timing_and_network' ? 30 : 15
  return Math.round(sizeComponent + signalBonus)
}

export type CoordinationSweepResult = {
  postsScanned: number
  clustersFound: number
  postsFlagged: number
}

export type CoordinationSweepWorker = {
  /** Runs one sweep pass immediately — exposed for tests, not just the interval. */
  runSweepOnce: () => Promise<CoordinationSweepResult>
  start: () => void
  stop: () => void
}

/**
 * ROADMAP.md 3.3f / SPECS.md §12.3 — periodically re-scans a recent window
 * of posts, clusters them by content similarity/timing/network fingerprint
 * (coordination-detector.ts), and flags every not-yet-flagged post in a
 * qualifying cluster for human review. Structured like
 * counters.flush-worker.ts (runOnce/start/stop, the interval is just a
 * thin wrapper) for the same reason: tests call runSweepOnce() directly,
 * without waiting on a real timer.
 */
export function createCoordinationSweepWorker(
  repository: CoordinationRepository,
  redis: Redis,
): CoordinationSweepWorker {
  let timer: NodeJS.Timeout | null = null

  async function flagCluster(cluster: CoordinationCluster): Promise<number> {
    const priority = computeClusterPriority(cluster.authorIds.length, cluster.reason)
    let flagged = 0
    for (const postId of cluster.postIds) {
      // SET NX — the same "claim, don't just check-then-act" idempotency
      // primitive as fanout.processor.ts/kafka-consumer.ts elsewhere in
      // this app, so two overlapping sweep ticks can't double-flag a post.
      const claimed = await redis.set(
        coordinationFlaggedKey(postId),
        '1',
        'EX',
        FLAGGED_TTL_SECONDS,
        'NX',
      )
      if (claimed !== 'OK') continue
      await repository.flagPostForReview(postId, cluster.authorIds.length, cluster.reason, priority)
      flagged++
    }
    return flagged
  }

  async function runSweepOnce(): Promise<CoordinationSweepResult> {
    const since = new Date(Date.now() - SWEEP_LOOKBACK_MS)
    const candidates = await repository.findRecentPosts(since)
    if (candidates.length === 0) {
      return { postsScanned: 0, clustersFound: 0, postsFlagged: 0 }
    }

    const authorIds = [...new Set(candidates.map((post) => post.authorId))]
    const authorIpAddresses = await repository.findLatestIpAddresses(authorIds)

    const clusters = detectCoordinatedClusters(candidates, {
      simhashDistanceThreshold: SIMHASH_DISTANCE_THRESHOLD,
      minClusterAuthors: MIN_CLUSTER_AUTHORS,
      timingWindowMs: TIMING_WINDOW_MS,
      authorIpAddresses,
    })

    let postsFlagged = 0
    for (const cluster of clusters) {
      postsFlagged += await flagCluster(cluster)
    }

    return { postsScanned: candidates.length, clustersFound: clusters.length, postsFlagged }
  }

  return {
    runSweepOnce,
    start() {
      timer = setInterval(() => {
        runSweepOnce().catch((error: unknown) => {
          console.error('coordination sweep failed:', error)
        })
      }, SWEEP_INTERVAL_MS)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
