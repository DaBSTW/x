import { FANOUT_QUEUE_NAME, type FanoutJobData } from '@x/utils'
import { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { createFanoutProcessor } from './fanout.processor.js'
import type { FanoutRepository } from './fanout.repository.js'

export type FanoutWorkerOptions = {
  repository: FanoutRepository
  redisUrl: string
  concurrency: number
}

export type FanoutWorkerHandle = {
  worker: Worker<FanoutJobData>
  close: () => Promise<void>
}

export function createFanoutWorker(options: FanoutWorkerOptions): FanoutWorkerHandle {
  // Two connections, matching apps/api's fanout-queue.ts: BullMQ's blocking
  // connection and the plain command connection used inside the processor
  // shouldn't share a socket.
  const bullmqConnection = new Redis(options.redisUrl, { maxRetriesPerRequest: null })
  const timelineRedis = new Redis(options.redisUrl)
  const process = createFanoutProcessor({ repository: options.repository, redis: timelineRedis })

  const worker = new Worker<FanoutJobData>(FANOUT_QUEUE_NAME, (job) => process(job.data), {
    connection: bullmqConnection,
    concurrency: options.concurrency,
  })

  return {
    worker,
    async close() {
      await worker.close()
      timelineRedis.disconnect()
    },
  }
}
