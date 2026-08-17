import { RUM_INGEST_QUEUE_NAME, type RumIngestJobData } from '@x/utils'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

export type RumIngestQueue = {
  enqueue: (data: RumIngestJobData) => Promise<void>
  close: () => Promise<void>
}

/**
 * Producer side of the RUM-ingest queue (ROADMAP.md 3.4g) — apps/workers is
 * the consumer, writing to ClickHouse. Same dedicated-connection reasoning
 * as trend-ingest-queue.ts/fanout-queue.ts.
 */
export function createRumIngestQueue(redisUrl: string): RumIngestQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
  const queue = new Queue<RumIngestJobData>(RUM_INGEST_QUEUE_NAME, { connection })

  return {
    // No jobId dedup key, same reasoning as trend-ingest-queue.ts: a
    // duplicate metric report only costs the next aggregation an inflated
    // sample count, never a correctness problem worth guarding against.
    async enqueue(data: RumIngestJobData): Promise<void> {
      await queue.add('rum-ingest', data)
    },
    async close(): Promise<void> {
      await queue.close()
      connection.disconnect()
    },
  }
}
