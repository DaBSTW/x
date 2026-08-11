import { MEDIA_PROCESSING_QUEUE_NAME, type MediaProcessingJobData } from '@x/utils'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

export type MediaQueue = {
  enqueue: (data: MediaProcessingJobData) => Promise<void>
  close: () => Promise<void>
}

/**
 * Producer side of the media-processing queue — ROADMAP.md 1.5. `apps/workers`
 * is the consumer. A dedicated Redis connection, same reason fanout-queue.ts
 * and notifications-queue.ts each use one instead of `app.redis`.
 */
export function createMediaQueue(redisUrl: string): MediaQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
  const queue = new Queue<MediaProcessingJobData>(MEDIA_PROCESSING_QUEUE_NAME, { connection })

  return {
    // jobId = mediaId: finalize is not itself idempotent-guarded, but
    // re-enqueuing the same media id is a safe no-op at the queue level —
    // matches fanout-queue.ts's jobId = postId precedent.
    //
    // Unlike fanout/notifications (default attempts: 1 — a missed fan-out
    // self-heals via lazy timeline reconstruction, SPECS.md §6.1), a failed
    // transcode has no such fallback: the upload just stays stuck. Real
    // work here means real, transient failure modes (S3 hiccup, a resource
    // limit), so it gets real retries.
    async enqueue(data: MediaProcessingJobData): Promise<void> {
      await queue.add('process', data, {
        jobId: data.mediaId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      })
    },
    async close(): Promise<void> {
      await queue.close()
      connection.disconnect()
    },
  }
}
