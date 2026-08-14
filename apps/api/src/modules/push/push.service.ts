import type { DevicePlatform } from '@x/contracts'
import type { PushRepository } from './push.repository.js'

export type CreatePushServiceOptions = {
  repository: PushRepository
  /** `null` when the server has no VAPID keypair configured (env.ts). */
  vapidPublicKey: string | null
}

export type PushService = ReturnType<typeof createPushService>

export function createPushService(options: CreatePushServiceOptions) {
  const { repository, vapidPublicKey } = options

  return {
    getVapidPublicKey(): string | null {
      return vapidPublicKey
    },

    async subscribe(
      userId: bigint,
      input: { endpoint: string; p256dh: string; authKey: string; userAgent: string | null },
    ): Promise<void> {
      await repository.upsertSubscription({ userId, ...input })
    },

    async unsubscribe(userId: bigint, endpoint: string): Promise<void> {
      await repository.deleteSubscription(userId, endpoint)
    },

    async registerDeviceToken(
      userId: bigint,
      input: { platform: DevicePlatform; token: string },
    ): Promise<void> {
      await repository.upsertDeviceToken({ userId, ...input })
    },

    async unregisterDeviceToken(userId: bigint, token: string): Promise<void> {
      await repository.deleteDeviceToken(userId, token)
    },
  }
}
