import { TREND_INGEST_QUEUE_NAME, type TrendIngestJobData } from '@x/utils'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

export type TrendIngestQueue = {
  enqueue: (data: TrendIngestJobData) => Promise<void>
  close: () => Promise<void>
}

/**
 * Producer side of the trend-ingest queue (ROADMAP.md 2.4) — apps/workers is
 * the consumer, writing to ClickHouse. Same dedicated-connection reasoning
 * as fanout-queue.ts: BullMQ documents its own connection lifecycle
 * expectations, worth keeping separate from the app's general-purpose
 * client.
 */
export function createTrendIngestQueue(redisUrl: string): TrendIngestQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
  const queue = new Queue<TrendIngestJobData>(TREND_INGEST_QUEUE_NAME, { connection })

  return {
    // No jobId dedup key here, unlike fanout-queue's jobId: postId — a
    // post's mentions are only ever enqueued once (posts.service.ts calls
    // this exactly once per created post), so there's no retry-of-a-
    // publish scenario to guard against the way fan-out has.
    async enqueue(data: TrendIngestJobData): Promise<void> {
      await queue.add('trend-ingest', data)
    },
    async close(): Promise<void> {
      await queue.close()
      connection.disconnect()
    },
  }
}
