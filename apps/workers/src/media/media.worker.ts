import { MEDIA_PROCESSING_QUEUE_NAME, type MediaProcessingJobData } from '@x/utils'
import { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { type MediaProcessorOptions, createMediaProcessor } from './media.processor.js'
import type { MediaRepository } from './media.repository.js'

export type MediaWorkerOptions = {
  repository: MediaRepository
  storage: MediaProcessorOptions['storage']
  bucket: string
  redisUrl: string
  concurrency: number
}

export type MediaWorkerHandle = {
  worker: Worker<MediaProcessingJobData>
  close: () => Promise<void>
}

export function createMediaWorker(options: MediaWorkerOptions): MediaWorkerHandle {
  const bullmqConnection = new Redis(options.redisUrl, { maxRetriesPerRequest: null })
  const process = createMediaProcessor({
    repository: options.repository,
    storage: options.storage,
    bucket: options.bucket,
  })

  const worker = new Worker<MediaProcessingJobData>(
    MEDIA_PROCESSING_QUEUE_NAME,
    (job) => process(job.data.mediaId),
    { connection: bullmqConnection, concurrency: options.concurrency },
  )

  // The processor itself never catches (see media.processor.ts) — it only
  // stops retrying and writes the terminal `failed` status here, once
  // BullMQ has exhausted the attempts configured in apps/api's media-queue.ts.
  worker.on('failed', (job, error) => {
    console.error(`media job ${job?.id ?? '(unknown)'} failed:`, error)
    if (!job) return
    const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1)
    if (isLastAttempt) {
      options.repository.markFailed(BigInt(job.data.mediaId)).catch((markFailedError: unknown) => {
        console.error(`media job ${job.id}: failed to record terminal failure:`, markFailedError)
      })
    }
  })

  return {
    worker,
    async close() {
      await worker.close()
    },
  }
}
