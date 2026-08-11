import { NOTIFICATIONS_QUEUE_NAME, type NotificationJobData, unreadCountKey } from '@x/utils'
import { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import type { NotificationsRepository } from './notifications.repository.js'

export type NotificationsWorkerOptions = {
  repository: NotificationsRepository
  redisUrl: string
  concurrency: number
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

  const worker = new Worker<NotificationJobData>(
    NOTIFICATIONS_QUEUE_NAME,
    async (job) => {
      const id = await options.repository.insertFromJob(job.data)
      if (id === null) return // blocked or muted (ROADMAP.md 2.6) — nothing was inserted, nothing to count

      // Only bump an already-warm counter. A cold one is left alone —
      // apps/api's getUnreadCount() recomputes it from Postgres on next
      // read, which by then already includes the row just inserted above.
      const key = unreadCountKey(job.data.userId)
      if (await redis.exists(key)) {
        await redis.incr(key)
      }
    },
    { connection: bullmqConnection, concurrency: options.concurrency },
  )

  return {
    worker,
    async close() {
      await worker.close()
      redis.disconnect()
    },
  }
}
