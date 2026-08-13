import type { Client } from '@opensearch-project/opensearch'
import type { Database } from '@x/db'
import { POSTS_SEARCH_INDEX, USERS_SEARCH_INDEX } from '@x/utils'
import { Kafka, logLevel } from 'kafkajs'
import { CDC_TOPICS, parseCdcMessage } from './cdc.js'
import { createSearchIndexerRepository } from './search-indexer.repository.js'

export type SearchIndexerConfig = {
  brokers: string[]
  groupId: string
  db: Database
  openSearchClient: Client
  /** SPECS.md §10.2: "bulk cada 500 documentos o 1 s (lo que ocurra antes)". */
  maxBatchSize?: number
  maxWaitMs?: number
}

export type SearchIndexer = {
  start: () => Promise<void>
  stop: () => Promise<void>
}

type PendingOffset = { topic: string; partition: number; offset: string }

/**
 * Consumes the CDC topics (cdc.ts's CDC_TOPICS) and keeps OpenSearch's
 * `posts`/`users` indices converged with Postgres. Accumulates distinct
 * touched ids in memory and flushes — re-fetch from Postgres, bulk
 * upsert/delete to OpenSearch, then commit offsets — whenever 500 distinct
 * ids are pending or 1 s has passed since the oldest one arrived, whichever
 * first (SPECS.md §10.2). `autoCommit` is off: offsets only advance after a
 * flush's bulk request actually succeeds, so a crash mid-flush re-delivers
 * the same ids on restart rather than silently dropping them — reprocessing
 * is always safe here, since re-indexing the same id twice converges on the
 * same document either way.
 */
export function createSearchIndexer(config: SearchIndexerConfig): SearchIndexer {
  const maxBatchSize = config.maxBatchSize ?? 500
  const maxWaitMs = config.maxWaitMs ?? 1000
  const repository = createSearchIndexerRepository(config.db)
  const kafka = new Kafka({
    clientId: 'x-search-indexer',
    brokers: config.brokers,
    // kafkajs's own default logger is noisy (INFO-level connect/disconnect
    // spam on every test run) — errors and above are all that matter here,
    // same signal-to-noise call already made for ioredis/BullMQ elsewhere.
    logLevel: logLevel.ERROR,
  })
  const consumer = kafka.consumer({ groupId: config.groupId })

  const pendingPostIds = new Set<bigint>()
  const pendingUserIds = new Set<bigint>()
  // Latest not-yet-committed offset per "topic-partition" — updated on
  // every message, including ones parseCdcMessage returns null for, so a
  // quiet or all-null partition still advances instead of being replayed
  // forever on every restart.
  const pendingOffsets = new Map<string, PendingOffset>()
  let oldestPendingAt: number | null = null
  let flushTimer: ReturnType<typeof setInterval> | null = null
  // Serializes every flush attempt (the 1 s timer and the 500-id threshold
  // can both fire close together) through one promise chain, so two flushes
  // never read/clear the pending sets concurrently.
  let flushChain: Promise<void> = Promise.resolve()

  function requestFlush(): Promise<void> {
    flushChain = flushChain.then(doFlush, (error: unknown) => {
      console.error('search-indexer: flush failed, will retry on the next trigger', error)
    })
    return flushChain
  }

  async function doFlush(): Promise<void> {
    if (pendingPostIds.size === 0 && pendingUserIds.size === 0) return
    const postIds = [...pendingPostIds]
    const userIds = [...pendingUserIds]
    const offsetsToCommit = [...pendingOffsets.values()]
    pendingPostIds.clear()
    pendingUserIds.clear()
    pendingOffsets.clear()
    oldestPendingAt = null

    const [postDocs, userDocs] = await Promise.all([
      repository.fetchPostDocuments(postIds),
      repository.fetchUserDocuments(userIds),
    ])
    const foundPostIds = new Set(postDocs.map((doc) => doc.id))
    const foundUserIds = new Set(userDocs.map((doc) => doc.id))
    const gonePostIds = postIds.filter((id) => !foundPostIds.has(id.toString()))
    const goneUserIds = userIds.filter((id) => !foundUserIds.has(id.toString()))

    const bulkBody: Record<string, unknown>[] = []
    for (const doc of postDocs) {
      bulkBody.push({ index: { _index: POSTS_SEARCH_INDEX, _id: doc.id } }, doc)
    }
    for (const doc of userDocs) {
      bulkBody.push({ index: { _index: USERS_SEARCH_INDEX, _id: doc.id } }, doc)
    }
    for (const id of gonePostIds) {
      bulkBody.push({ delete: { _index: POSTS_SEARCH_INDEX, _id: id.toString() } })
    }
    for (const id of goneUserIds) {
      bulkBody.push({ delete: { _index: USERS_SEARCH_INDEX, _id: id.toString() } })
    }

    if (bulkBody.length > 0) {
      const { body: result } = await config.openSearchClient.bulk({ body: bulkBody })
      if (result.errors) {
        const failed = result.items.filter((item) => Object.values(item)[0]?.error)
        // Best-effort, same swallow-on-error posture as fan-out/notifications:
        // one bad item (a mapping mismatch, a transient shard issue) must
        // never wedge the whole consumer — the next event touching that same
        // id, or a future backfill, gets another chance.
        console.error(`search-indexer: bulk had ${failed.length} failing item(s)`, failed)
      }
    }

    if (offsetsToCommit.length > 0) {
      await consumer.commitOffsets(offsetsToCommit)
    }
  }

  return {
    async start() {
      await consumer.connect()
      await consumer.subscribe({ topics: CDC_TOPICS, fromBeginning: false })
      flushTimer = setInterval(() => {
        if (oldestPendingAt !== null && Date.now() - oldestPendingAt >= maxWaitMs) {
          void requestFlush()
        }
      }, 100)
      await consumer.run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message }) => {
          pendingOffsets.set(`${topic}-${partition}`, {
            topic,
            partition,
            // kafkajs commits "the next offset to read", not the offset just
            // consumed — BigInt, not Number, for the same reason ids are:
            // an offset is a real (if currently theoretical) int64.
            offset: (BigInt(message.offset) + 1n).toString(),
          })

          const parsed = parseCdcMessage(topic, message.value)
          if (parsed) {
            if (oldestPendingAt === null) oldestPendingAt = Date.now()
            const pending = parsed.entity === 'post' ? pendingPostIds : pendingUserIds
            pending.add(parsed.id)
          }

          if (pendingPostIds.size + pendingUserIds.size >= maxBatchSize) {
            await requestFlush()
          }
        },
      })
    },

    async stop() {
      if (flushTimer) clearInterval(flushTimer)
      await requestFlush()
      await consumer.disconnect()
    },
  }
}
