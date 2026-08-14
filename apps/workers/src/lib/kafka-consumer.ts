import { dlqTopicName } from '@x/utils'
import type { Redis } from 'ioredis'
import type { Consumer, Kafka, Producer } from 'kafkajs'

export type KafkaEventConsumerHandle = {
  start: () => Promise<void>
  stop: () => Promise<void>
}

export type KafkaEventConsumerOptions<T> = {
  kafka: Kafka
  /** Shared with the process's other consumers — one real TCP connection to the broker, not one per topic. */
  producer: Producer
  groupId: string
  topic: string
  redis: Redis
  /** `null` for a message this consumer can't even parse — skipped without retrying or DLQing (there's nothing reconstructable to hand a human inspecting the DLQ). */
  parse: (raw: Buffer | null) => T | null
  /** SPECS.md §3.3's "clave `event_id` deduplicada" — the caller's own business key, not a synthetic one, so a message somehow re-produced (not just re-delivered) still only takes effect once. */
  idempotencyKey: (data: T) => string
  handle: (data: T) => Promise<void>
  /** kafkajs's own real equivalent of BullMQ's `concurrency` — how many partitions this consumer processes in parallel, rather than strictly one message at a time. Default 1 (sequential). */
  partitionsConsumedConcurrently?: number
  /** In-process attempts before giving up on a message and routing it to `<topic>.dlq` — default 3. */
  maxAttempts?: number
  /** Base delay between in-process retries, multiplied by the attempt number — default 200ms. */
  retryDelayMs?: number
  /** SPECS.md's own consumer-lag budget (ROADMAP.md 3.1's own bullet: "alerta a > 60 s") — default 60s. */
  lagWarningMs?: number
}

/**
 * A Kafka consumer with the three properties ROADMAP.md 3.1 asks every
 * migrated consumer to have, built once and reused by both
 * fanout.worker.ts and notifications.worker.ts instead of duplicated
 * per-topic:
 *
 * - **Idempotency** (SPECS.md §3.3) — a Redis `SET NX` keyed by the
 *   caller's own business key, TTL 24h, checked before `handle()` ever
 *   runs. A message redelivered after a consumer-group rebalance (offset
 *   committed but the crash happened before the commit landed) is a no-op
 *   the second time, not a duplicate side effect.
 * - **Dead letter queue** — `handle()` gets `maxAttempts` in-process tries
 *   with a short backoff between them (rides out a transient blip without
 *   ever touching Kafka's own retry semantics, which retry the *fetch*,
 *   not a failure inside `eachMessage` itself). Still failing after that
 *   is presumed a bad message, not a bad moment — it's produced verbatim
 *   to `<topic>.dlq` (inspectable and replayable later) and the original
 *   offset commits normally, so one poison message can never block the
 *   whole partition forever.
 * - **Lag monitoring** — Kafka's own broker-assigned `message.timestamp`
 *   compared to now, on every message; a `console.warn` once it exceeds
 *   `lagWarningMs`, matching every other "not fatal, just noisy" alert
 *   posture already used in this codebase (ClickHouse/OpenSearch
 *   unreachable at boot, etc.) rather than a service this repo doesn't
 *   have yet (ROADMAP.md 3.6 is where a real dashboard/alerting backend
 *   would consume this signal instead of a log line).
 */
export function createKafkaEventConsumer<T>(
  options: KafkaEventConsumerOptions<T>,
): KafkaEventConsumerHandle {
  const maxAttempts = options.maxAttempts ?? 3
  const retryDelayMs = options.retryDelayMs ?? 200
  const lagWarningMs = options.lagWarningMs ?? 60_000
  const dlqTopic = dlqTopicName(options.topic)
  const consumer: Consumer = options.kafka.consumer({ groupId: options.groupId })

  function checkLag(timestamp: string | undefined): void {
    if (!timestamp) return
    const lagMs = Date.now() - Number(timestamp)
    if (lagMs > lagWarningMs) {
      console.warn(
        `${options.groupId}: consumer lag on ${options.topic} is ${Math.round(lagMs / 1000)}s, over the ${Math.round(lagWarningMs / 1000)}s budget (SPECS.md's own consumer-lag SLO)`,
      )
    }
  }

  async function sendToDlq(
    message: { key: Buffer | null; value: Buffer | null },
    error: unknown,
  ): Promise<void> {
    console.error(
      `${options.groupId}: giving up on a ${options.topic} message after ${maxAttempts} attempts, routing to ${dlqTopic}`,
      error,
    )
    await options.producer.send({
      topic: dlqTopic,
      messages: [
        {
          key: message.key,
          value: message.value,
          headers: { 'x-dlq-reason': error instanceof Error ? error.message : String(error) },
        },
      ],
    })
  }

  return {
    async start() {
      await consumer.connect()
      await consumer.subscribe({ topic: options.topic, fromBeginning: false })
      await consumer.run({
        partitionsConsumedConcurrently: options.partitionsConsumedConcurrently ?? 1,
        eachMessage: async ({ message }) => {
          checkLag(message.timestamp)

          const data = options.parse(message.value)
          if (!data) return

          const dedupeKey = `kafka:processed:${options.topic}:${options.idempotencyKey(data)}`
          const claimed = await options.redis.set(dedupeKey, '1', 'EX', 24 * 60 * 60, 'NX')
          if (claimed === null) return // already handled — a redelivery, not a new event

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              await options.handle(data)
              return
            } catch (error) {
              if (attempt === maxAttempts) {
                await sendToDlq(message, error)
                return
              }
              await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt))
            }
          }
        },
      })
    },

    async stop() {
      await consumer.disconnect()
    },
  }
}
