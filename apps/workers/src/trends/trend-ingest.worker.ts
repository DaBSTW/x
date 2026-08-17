import { TREND_INGEST_QUEUE_NAME, type TrendIngestJobData } from '@x/utils'
import { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { createTrendIngestProcessor } from './trend-ingest.processor.js'
import type { TrendIngestRepository } from './trend-ingest.repository.js'

export type TrendIngestWorkerOptions = {
  repository: TrendIngestRepository
  redisUrl: string
  concurrency: number
}

export type TrendIngestWorkerHandle = {
  worker: Worker<TrendIngestJobData>
  close: () => Promise<void>
}

export function createTrendIngestWorker(
  options: TrendIngestWorkerOptions,
): TrendIngestWorkerHandle {
  // maxRetriesPerRequest: null is BullMQ's own hard requirement (its
  // internal blocking-wait polling would otherwise error) — CODESTYLE.md
  // §10's 200ms Redis budget deliberately doesn't apply to this connection.
  const bullmqConnection = new Redis(options.redisUrl, { maxRetriesPerRequest: null })
  const process = createTrendIngestProcessor({ repository: options.repository })

  const worker = new Worker<TrendIngestJobData>(
    TREND_INGEST_QUEUE_NAME,
    (job) => process(job.data),
    { connection: bullmqConnection, concurrency: options.concurrency },
  )

  return {
    worker,
    async close() {
      await worker.close()
    },
  }
}
