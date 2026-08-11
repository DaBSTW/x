import { NOTIFICATIONS_QUEUE_NAME, type NotificationJobData } from '@x/utils'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

export type NotificationsQueue = {
  enqueue: (data: NotificationJobData) => Promise<void>
  close: () => Promise<void>
}

/**
 * Producer side of the notifications queue — SPECS.md §3, ROADMAP.md 1.7.
 * `apps/workers` is the consumer. A dedicated Redis connection, same reason
 * fanout-queue.ts uses one instead of `app.redis`.
 */
export function createNotificationsQueue(redisUrl: string): NotificationsQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
  const queue = new Queue<NotificationJobData>(NOTIFICATIONS_QUEUE_NAME, { connection })

  return {
    // No fixed jobId: unlike fan-out (one post, one fan-out), a single post
    // can generate several independent notification events (a like, then a
    // reply, then a mention) that must each land as their own row.
    async enqueue(data: NotificationJobData): Promise<void> {
      await queue.add('notify', data)
    },
    async close(): Promise<void> {
      await queue.close()
      connection.disconnect()
    },
  }
}
