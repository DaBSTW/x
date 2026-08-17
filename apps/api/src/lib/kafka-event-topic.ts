import { INTERNAL_CALL_TIMEOUT_MS } from '@x/utils'
import { Kafka, type Producer, logLevel } from 'kafkajs'

export type KafkaEventTopic<T> = {
  enqueue: (data: T) => Promise<void>
  close: () => Promise<void>
}

export type KafkaEventTopicOptions<T> = {
  brokers: string
  clientId: string
  topic: string
  /** Kafka partitions by this — SPECS.md's own "particionado por user_id para preservar el orden por usuario" (post.created: authorId; interaction.events: the notification recipient's userId). */
  partitionKey: (data: T) => string
}

/**
 * Producer side of a Kafka topic — ROADMAP.md 3.1, replacing the BullMQ
 * queues fanout-queue.ts/notifications-queue.ts used to be. Same
 * `{enqueue, close}` shape those had, so app.ts's own wiring barely
 * changes and every caller (posts.service.ts's onPostCreated,
 * interactions.service.ts/social-graph.service.ts's publishNotification)
 * needs no changes at all — they already only depended on that shape, not
 * on BullMQ specifically.
 *
 * `idempotent: true` extends SPECS.md §3.3's "idempotencia obligatoria" to
 * the *produce* side too: kafkajs's idempotent producer guarantees a
 * broker-level retry (a network blip between this process and the broker)
 * never appends the same message twice, on top of the consumer-side
 * dedup apps/workers' kafka-consumer.ts applies on the way out.
 *
 * Connects lazily on the first `enqueue()` rather than in the constructor
 * — app.ts calls this eagerly at boot (matching the OpenSearch/ClickHouse
 * "warm the connection, but don't block startup on it" posture elsewhere
 * in this codebase) via a fire-and-forget `.enqueue`-independent connect
 * attempt it wraps in try/catch itself; if that fails, this class simply
 * tries again on the next real `enqueue()` call instead of ever assuming
 * connection state it can't verify.
 */
export function createKafkaEventTopic<T>(options: KafkaEventTopicOptions<T>): KafkaEventTopic<T> {
  const kafka = new Kafka({
    clientId: options.clientId,
    brokers: options.brokers.split(','),
    logLevel: logLevel.ERROR,
    // kafkajs's own default (5 retries, up to 30s each) is tuned for a
    // long-lived background consumer, not a call sitting on a live HTTP
    // request's critical path — every caller here already treats a produce
    // failure as non-fatal (posts.service.ts/social-graph.service.ts wrap
    // this in try/catch), but without a tighter bound an unreachable broker
    // would still make every affected request hang for several seconds
    // before that catch ever runs. Bounded small instead: one quick retry
    // rides out a genuine transient blip, and a real outage still fails
    // within a fraction of a second.
    retry: { retries: 2, initialRetryTime: 100, maxRetryTime: 500 },
    // SPECS.md §14.4 / CODESTYLE.md §10's "servicio interno 1 s" — bounds
    // each individual attempt above, distinct from (and tighter than) the
    // retry policy's own spacing between attempts.
    requestTimeout: INTERNAL_CALL_TIMEOUT_MS,
  })
  const producer: Producer = kafka.producer({ idempotent: true })
  let connected = false

  async function ensureConnected(): Promise<void> {
    if (connected) return
    await producer.connect()
    connected = true
  }

  return {
    async enqueue(data: T): Promise<void> {
      await ensureConnected()
      await producer.send({
        topic: options.topic,
        messages: [{ key: options.partitionKey(data), value: JSON.stringify(data) }],
      })
    },
    async close(): Promise<void> {
      if (connected) await producer.disconnect()
    },
  }
}
