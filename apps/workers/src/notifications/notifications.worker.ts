import { NOTIFICATIONS_QUEUE_NAME, type NotificationJobData } from '@x/utils'
import { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { createNotificationsProcessor } from './notifications.processor.js'
import type { NotificationsRepository } from './notifications.repository.js'
import type { SendPush } from './push-sender.js'

export type NotificationsWorkerOptions = {
  repository: NotificationsRepository
  redisUrl: string
  concurrency: number
  /** `undefined` when no VAPID keypair is configured — push is then skipped entirely (env.ts). */
  sendPush?: SendPush
}

export type NotificationsWorkerHandle = {
  worker: Worker<NotificationJobData>
  close: () => Promise<void>
}

export function createNotificationsWorker(
  options: NotificationsWorkerOptions,
): NotificationsWorkerHandle {
  // Two connections, matching fanout.worker.ts: BullMQ's blocking connection
  // and the plain command connection used inside the processor shouldn't
  // share a socket.
  const bullmqConnection = new Redis(options.redisUrl, { maxRetriesPerRequest: null })
  const redis = new Redis(options.redisUrl)
  const process = createNotificationsProcessor({
    repository: options.repository,
    redis,
    ...(options.sendPush !== undefined && { sendPush: options.sendPush }),
  })

  const worker = new Worker<NotificationJobData>(
    NOTIFICATIONS_QUEUE_NAME,
    (job) => process(job.data),
    {
      connection: bullmqConnection,
      concurrency: options.concurrency,
    },
  )

  return {
    worker,
    async close() {
      await worker.close()
      redis.disconnect()
    },
  }
}
