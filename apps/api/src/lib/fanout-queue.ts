import { FANOUT_QUEUE_NAME, type FanoutJobData } from '@x/utils'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

export type FanoutQueue = {
  enqueue: (data: FanoutJobData) => Promise<void>
  close: () => Promise<void>
}

/**
 * Producer side of the fan-out queue — SPECS.md §6.1. `apps/workers` is the
 * consumer. A dedicated Redis connection (not `app.redis`): BullMQ documents
 * its own connection lifecycle expectations, and mixing it with the app's
 * general-purpose client risks surprising interactions during shutdown.
 */
export function createFanoutQueue(redisUrl: string): FanoutQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
  const queue = new Queue<FanoutJobData>(FANOUT_QUEUE_NAME, { connection })

  return {
    async enqueue(data: FanoutJobData): Promise<void> {
      // jobId = postId: re-publishing the same post is a no-op at the queue
      // level. The worker also checks Redis explicitly for idempotency
      // (SPECS.md §3.3) in case a job is retried after already completing.
      await queue.add('fanout', data, { jobId: data.postId })
    },
    async close(): Promise<void> {
      await queue.close()
      connection.disconnect()
    },
  }
}
