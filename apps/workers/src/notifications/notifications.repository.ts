import type { Database } from '@x/db'
import { notifications } from '@x/db'
import { type NotificationJobData, generateId } from '@x/utils'

export type NotificationsRepository = ReturnType<typeof createNotificationsRepository>

export function createNotificationsRepository(db: Database) {
  return {
    async insertFromJob(data: NotificationJobData): Promise<bigint> {
      const id = generateId()
      await db.insert(notifications).values({
        id,
        userId: BigInt(data.userId),
        kind: data.kind,
        actorId: data.actorId ? BigInt(data.actorId) : null,
        postId: data.postId ? BigInt(data.postId) : null,
        groupKey: data.groupKey,
      })
      return id
    },
  }
}
