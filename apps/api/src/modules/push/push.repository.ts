import type { Database } from '@x/db'
import { pushSubscriptions } from '@x/db'
import { generateId } from '@x/utils'
import { and, eq } from 'drizzle-orm'

export type PushRepository = ReturnType<typeof createPushRepository>

export function createPushRepository(db: Database) {
  return {
    /** A repeat POST from the same browser (endpoint) re-points it at whichever account is calling now, rather than erroring. */
    async upsertSubscription(input: {
      userId: bigint
      endpoint: string
      p256dh: string
      authKey: string
      userAgent: string | null
    }): Promise<void> {
      await db
        .insert(pushSubscriptions)
        .values({ id: generateId(), ...input })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId: input.userId,
            p256dh: input.p256dh,
            authKey: input.authKey,
            userAgent: input.userAgent,
          },
        })
    },

    /** Scoped to the caller's own userId — one account can't unsubscribe another's device. */
    async deleteSubscription(userId: bigint, endpoint: string): Promise<void> {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    },
  }
}
