import { type FanoutJobData, POST_CREATED_TOPIC } from '@x/utils'
import type { Redis } from 'ioredis'
import type { Kafka, Producer } from 'kafkajs'
import { createKafkaEventConsumer } from '../lib/kafka-consumer.js'
import { createFanoutProcessor } from './fanout.processor.js'
import type { FanoutRepository } from './fanout.repository.js'

export type FanoutWorkerOptions = {
  repository: FanoutRepository
  kafka: Kafka
  /** Shared across every consumer in the process — DLQ writes go through this, not a connection of the consumer's own. */
  producer: Producer
  redis: Redis
  /** kafkajs's `partitionsConsumedConcurrently` — the real equivalent of BullMQ's old `concurrency`. */
  concurrency: number
  /** A parameter, not hard-coded — same reasoning as search-indexer.worker.ts's own `groupId`: server.ts passes the one real `FANOUT_CONSUMER_GROUP` (@x/utils), a test passes its own unique group per run for isolation instead of colliding with (or replaying stale offsets from) every other test in the same file. */
  groupId: string
}

export type FanoutWorkerHandle = {
  start: () => Promise<void>
  close: () => Promise<void>
}

function parseFanoutMessage(raw: Buffer | null): FanoutJobData | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as Partial<FanoutJobData>
    if (typeof parsed.postId !== 'string' || typeof parsed.authorId !== 'string') return null
    return { postId: parsed.postId, authorId: parsed.authorId }
  } catch {
    return null
  }
}

/**
 * ROADMAP.md 3.1 — Kafka consumer for `post.created`, replacing the BullMQ
 * `Worker` this used to be. `fanout.processor.ts` itself is unchanged
 * (transport-agnostic, always was); this file only swaps what delivers
 * jobs to it. Its own `SET NX fanout:processed:{postId}` guard (already
 * there before this migration) and kafka-consumer.ts's own generic
 * `idempotencyKey`-based guard now overlap for this one topic — kept
 * deliberately rather than removed: the processor's guard also covers
 * `processFanoutJob` being invoked outside this Kafka path entirely (a
 * manual backfill script, a future direct call), which the wrapper's
 * guard can't. Two cheap `SET NX` calls, not a design flaw.
 */
export function createFanoutWorker(options: FanoutWorkerOptions): FanoutWorkerHandle {
  const process = createFanoutProcessor({ repository: options.repository, redis: options.redis })
  const consumer = createKafkaEventConsumer<FanoutJobData>({
    kafka: options.kafka,
    producer: options.producer,
    groupId: options.groupId,
    topic: POST_CREATED_TOPIC,
    redis: options.redis,
    parse: parseFanoutMessage,
    idempotencyKey: (data) => data.postId,
    handle: process,
    partitionsConsumedConcurrently: options.concurrency,
  })

  return {
    start: () => consumer.start(),
    close: () => consumer.stop(),
  }
}
