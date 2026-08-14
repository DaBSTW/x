import { INTERACTION_EVENTS_TOPIC, NOTIFICATION_KINDS, type NotificationJobData } from '@x/utils'
import type { Redis } from 'ioredis'
import type { Kafka, Producer } from 'kafkajs'
import { createKafkaEventConsumer } from '../lib/kafka-consumer.js'
import type { SendApnsPush } from './apns-sender.js'
import type { SendFcmPush } from './fcm-sender.js'
import { createNotificationsProcessor } from './notifications.processor.js'
import type { NotificationsRepository } from './notifications.repository.js'
import type { SendPush } from './push-sender.js'

export type NotificationsWorkerOptions = {
  repository: NotificationsRepository
  kafka: Kafka
  producer: Producer
  redis: Redis
  concurrency: number
  /** A parameter, not hard-coded — see fanout.worker.ts's identical `groupId` option for why. */
  groupId: string
  /** `undefined` when no VAPID keypair is configured — push is then skipped entirely (env.ts). */
  sendPush?: SendPush
  /** `undefined` when no FCM service account is configured — ROADMAP.md 2.9. */
  sendFcmPush?: SendFcmPush
  /** `undefined` when no APNs credentials are configured — ROADMAP.md 2.9. */
  sendApnsPush?: SendApnsPush
}

export type NotificationsWorkerHandle = {
  start: () => Promise<void>
  close: () => Promise<void>
}

type InteractionEvent = NotificationJobData & { eventId: string }

const NOTIFICATION_KIND_SET = new Set<string>(NOTIFICATION_KINDS)

function parseInteractionEvent(raw: Buffer | null): InteractionEvent | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as Partial<InteractionEvent>
    if (
      typeof parsed.eventId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.kind !== 'string' ||
      !NOTIFICATION_KIND_SET.has(parsed.kind) ||
      (parsed.actorId !== null && typeof parsed.actorId !== 'string') ||
      (parsed.postId !== null && typeof parsed.postId !== 'string') ||
      (parsed.groupKey !== null && typeof parsed.groupKey !== 'string')
    ) {
      return null
    }
    return parsed as InteractionEvent
  } catch {
    return null
  }
}

/**
 * ROADMAP.md 3.1 — Kafka consumer for `interaction.events`, replacing the
 * BullMQ `Worker` this used to be. `notifications.processor.ts` itself is
 * unchanged: it already only depended on `NotificationJobData`'s own
 * fields, so the extra `eventId` this topic's messages carry (added
 * purely so kafka-consumer.ts's generic idempotency guard has a real key
 * to dedupe on — see app.ts's own publishNotification for where it's
 * generated) simply passes through unread.
 */
export function createNotificationsWorker(
  options: NotificationsWorkerOptions,
): NotificationsWorkerHandle {
  const process = createNotificationsProcessor({
    repository: options.repository,
    redis: options.redis,
    ...(options.sendPush !== undefined && { sendPush: options.sendPush }),
    ...(options.sendFcmPush !== undefined && { sendFcmPush: options.sendFcmPush }),
    ...(options.sendApnsPush !== undefined && { sendApnsPush: options.sendApnsPush }),
  })
  const consumer = createKafkaEventConsumer<InteractionEvent>({
    kafka: options.kafka,
    producer: options.producer,
    groupId: options.groupId,
    topic: INTERACTION_EVENTS_TOPIC,
    redis: options.redis,
    parse: parseInteractionEvent,
    idempotencyKey: (data) => data.eventId,
    handle: process,
    partitionsConsumedConcurrently: options.concurrency,
  })

  return {
    start: () => consumer.start(),
    close: () => consumer.stop(),
  }
}
