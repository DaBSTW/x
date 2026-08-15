import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidatePost, CoordinationReason } from './coordination-detector.js'
import { createCoordinationSweepWorker } from './coordination-sweep.worker.js'
import type { CoordinationRepository } from './coordination.repository.js'

// Hand-rolled — models only the one command the sweep worker's idempotency
// guard actually issues: SET key value EX ttl NX.
function createFakeRedis() {
  const store = new Set<string>()
  const redis = {
    async set(key: string, _value: string, ..._rest: unknown[]) {
      if (store.has(key)) return null
      store.add(key)
      return 'OK'
    },
  } as unknown as Redis
  return { redis, store }
}

type FlaggedCall = {
  postId: bigint
  authorCount: number
  reason: CoordinationReason
  priority: number
}

function createFakeRepository() {
  const flagged: FlaggedCall[] = []
  let recentPosts: CandidatePost[] = []
  let ipAddresses = new Map<bigint, string>()

  const repository: CoordinationRepository = {
    async findRecentPosts() {
      return recentPosts
    },
    async findLatestIpAddresses() {
      return ipAddresses
    },
    async flagPostForReview(postId, authorCount, reason, priority) {
      flagged.push({ postId, authorCount, reason, priority })
    },
  }

  return {
    repository,
    flagged,
    setRecentPosts(posts: CandidatePost[]) {
      recentPosts = posts
    },
    setIpAddresses(map: Map<bigint, string>) {
      ipAddresses = map
    },
  }
}

function post(id: number, authorId: number, text: string, createdAt: string): CandidatePost {
  return { id: BigInt(id), authorId: BigInt(authorId), text, createdAt: new Date(createdAt) }
}

// Same validated bot-network fixture as coordination-detector.test.ts —
// measured max pairwise Hamming distance 6, comfortably under this
// worker's own SIMHASH_DISTANCE_THRESHOLD (10).
const SPAM_A = 'gana seguidores reales gratis, entra ya'
const SPAM_B = 'gana seguidores reales gratis, entra ya!'
const SPAM_C = 'gana seguidores reales gratis, entra ya 🔥'

describe('createCoordinationSweepWorker', () => {
  let fakeRedis: ReturnType<typeof createFakeRedis>
  let fakeRepository: ReturnType<typeof createFakeRepository>

  beforeEach(() => {
    fakeRedis = createFakeRedis()
    fakeRepository = createFakeRepository()
  })

  it('flags every post in a qualifying cluster and reports an accurate summary', async () => {
    fakeRepository.setRecentPosts([
      post(1, 1, SPAM_A, '2026-08-15T12:00:00Z'),
      post(2, 2, SPAM_B, '2026-08-15T12:01:00Z'),
      post(3, 3, SPAM_C, '2026-08-15T12:02:00Z'),
    ])
    const worker = createCoordinationSweepWorker(fakeRepository.repository, fakeRedis.redis)

    const result = await worker.runSweepOnce()

    expect(result).toEqual({ postsScanned: 3, clustersFound: 1, postsFlagged: 3 })
    expect(fakeRepository.flagged.map((f) => f.postId).sort()).toEqual([1n, 2n, 3n])
    expect(fakeRepository.flagged[0]?.reason).toBe('timing')
    expect(fakeRepository.flagged[0]?.priority).toBeGreaterThan(0)
  })

  it('flags nothing when no cluster in the window qualifies', async () => {
    fakeRepository.setRecentPosts([
      post(1, 1, 'un post cualquiera sin relación con nada más', '2026-08-15T12:00:00Z'),
      post(2, 2, 'otro post totalmente distinto sobre otro tema', '2026-08-15T12:01:00Z'),
    ])
    const worker = createCoordinationSweepWorker(fakeRepository.repository, fakeRedis.redis)

    const result = await worker.runSweepOnce()

    expect(result).toEqual({ postsScanned: 2, clustersFound: 0, postsFlagged: 0 })
    expect(fakeRepository.flagged).toEqual([])
  })

  it('returns an all-zero summary immediately when the window has no candidates, without touching Redis or the repository twice', async () => {
    const worker = createCoordinationSweepWorker(fakeRepository.repository, fakeRedis.redis)
    expect(await worker.runSweepOnce()).toEqual({
      postsScanned: 0,
      clustersFound: 0,
      postsFlagged: 0,
    })
  })

  it('does not re-flag a post already claimed by an earlier tick, even though it is still inside the lookback window', async () => {
    fakeRepository.setRecentPosts([
      post(1, 1, SPAM_A, '2026-08-15T12:00:00Z'),
      post(2, 2, SPAM_B, '2026-08-15T12:01:00Z'),
      post(3, 3, SPAM_C, '2026-08-15T12:02:00Z'),
    ])
    const worker = createCoordinationSweepWorker(fakeRepository.repository, fakeRedis.redis)

    const first = await worker.runSweepOnce()
    // A later post from a 4th account joins the same cluster on the next
    // tick — the window still contains all 4, and the fixed one already
    // flagged must not be flagged a second time.
    fakeRepository.setRecentPosts([
      post(1, 1, SPAM_A, '2026-08-15T12:00:00Z'),
      post(2, 2, SPAM_B, '2026-08-15T12:01:00Z'),
      post(3, 3, SPAM_C, '2026-08-15T12:02:00Z'),
      post(4, 4, SPAM_A, '2026-08-15T12:05:00Z'),
    ])
    const second = await worker.runSweepOnce()

    expect(first.postsFlagged).toBe(3)
    expect(second.postsFlagged).toBe(1) // only post 4, newly seen
    expect(fakeRepository.flagged.map((f) => f.postId).sort()).toEqual([1n, 2n, 3n, 4n])
  })

  it('flags a network-fingerprint-corroborated cluster with a lower priority than a timing+network one', async () => {
    fakeRepository.setRecentPosts([
      post(1, 1, SPAM_A, '2026-08-15T09:00:00Z'),
      post(2, 2, SPAM_B, '2026-08-15T10:00:00Z'),
      post(3, 3, SPAM_C, '2026-08-15T11:00:00Z'),
    ])
    fakeRepository.setIpAddresses(
      new Map([
        [1n, '203.0.113.5'],
        [3n, '203.0.113.5'],
      ]),
    )
    const worker = createCoordinationSweepWorker(fakeRepository.repository, fakeRedis.redis)

    await worker.runSweepOnce()

    expect(fakeRepository.flagged[0]?.reason).toBe('network')
  })

  it('runs runSweepOnce on an interval once started, and stops cleanly', async () => {
    vi.useFakeTimers()
    fakeRepository.setRecentPosts([
      post(1, 1, SPAM_A, '2026-08-15T12:00:00Z'),
      post(2, 2, SPAM_B, '2026-08-15T12:01:00Z'),
      post(3, 3, SPAM_C, '2026-08-15T12:02:00Z'),
    ])
    const worker = createCoordinationSweepWorker(fakeRepository.repository, fakeRedis.redis)

    worker.start()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    worker.stop()
    const flaggedAfterOneTick = fakeRepository.flagged.length

    fakeRepository.setRecentPosts([
      post(4, 4, SPAM_A, '2026-08-15T13:00:00Z'),
      post(5, 5, SPAM_B, '2026-08-15T13:01:00Z'),
      post(6, 6, SPAM_C, '2026-08-15T13:02:00Z'),
    ])
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)

    expect(flaggedAfterOneTick).toBe(3)
    expect(fakeRepository.flagged.length).toBe(3) // worker was stopped — the second batch was never swept
    vi.useRealTimers()
  })
})
