import type { DevicePlatform } from '@x/contracts'
import type { Database } from '@x/db'
import { deviceTokens, pushSubscriptions } from '@x/db'
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

    /** Same re-point-not-duplicate posture as upsertSubscription above, keyed on the token instead of an endpoint URL. */
    async upsertDeviceToken(input: {
      userId: bigint
      platform: DevicePlatform
      token: string
    }): Promise<void> {
      await db
        .insert(deviceTokens)
        .values({ id: generateId(), ...input })
        .onConflictDoUpdate({
          target: deviceTokens.token,
          set: { userId: input.userId, platform: input.platform },
        })
    },

    /** Scoped to the caller's own userId, same reasoning as deleteSubscription. */
    async deleteDeviceToken(userId: bigint, token: string): Promise<void> {
      await db
        .delete(deviceTokens)
        .where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token)))
    },
  }
}
