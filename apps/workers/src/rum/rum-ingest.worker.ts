import { RUM_INGEST_QUEUE_NAME, type RumIngestJobData } from '@x/utils'
import { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { createRumIngestProcessor } from './rum-ingest.processor.js'
import type { RumIngestRepository } from './rum-ingest.repository.js'

export type RumIngestWorkerOptions = {
  repository: RumIngestRepository
  redisUrl: string
  concurrency: number
}

export type RumIngestWorkerHandle = {
  worker: Worker<RumIngestJobData>
  close: () => Promise<void>
}

export function createRumIngestWorker(options: RumIngestWorkerOptions): RumIngestWorkerHandle {
  // maxRetriesPerRequest: null is BullMQ's own hard requirement (its
  // internal blocking-wait polling would otherwise error) — CODESTYLE.md
  // §10's 200ms Redis budget deliberately doesn't apply to this connection.
  const bullmqConnection = new Redis(options.redisUrl, { maxRetriesPerRequest: null })
  const process = createRumIngestProcessor({ repository: options.repository })

  const worker = new Worker<RumIngestJobData>(RUM_INGEST_QUEUE_NAME, (job) => process(job.data), {
    connection: bullmqConnection,
    concurrency: options.concurrency,
  })

  return {
    worker,
    async close() {
      await worker.close()
    },
  }
}
