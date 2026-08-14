import type { Kafka } from 'kafkajs'

// ROADMAP.md 3.1 — Kafka topics replacing BullMQ for the two flows SPECS.md
// §3.2's own architecture diagram names first (`post.created`, a fan-out
// producer/consumer pair) and §13.1 names second ("Los eventos de Kafka
// (`interaction.like`, `follow.created`, etc.) alimentan al worker de
// notificaciones"). Consolidated into one topic per flow rather than one
// topic per interaction *kind*: every kind already shared a single BullMQ
// queue and a single consumer (notifications.worker.ts) before this
// checkpoint, with `kind` living as a field on the payload rather than in
// the topic name — migrating the transport without also fragmenting one
// well-tested consumer into N per-kind ones is the honest, minimal version
// of this bullet, not a shortcut around it. Shared between apps/api
// (producer) and apps/workers (consumer), same reason queues.ts/
// notifications.ts already are — the topic name and the payload shape are
// the contract between two separate processes.

export const POST_CREATED_TOPIC = 'post.created'
export const INTERACTION_EVENTS_TOPIC = 'interaction.events'

/** Where a message lands after `handle()` fails `maxAttempts` times in a row — inspectable and replayable later, never silently dropped. */
export function dlqTopicName(topic: string): string {
  return `${topic}.dlq`
}

/**
 * More than the default worker concurrency (4, env.ts in both apps/api and
 * apps/workers) so a future bump to that setting has somewhere to go
 * without a disruptive repartition later — Kafka can't shrink partitions,
 * and growing them changes which partition an existing key hashes to, so
 * picking a number once, with headroom, beats fixing it up after the fact.
 */
export const DEFAULT_KAFKA_TOPIC_PARTITIONS = 6

/**
 * Idempotent, safe to call on every boot — same "ensure the infra this
 * process depends on exists before serving traffic" posture as
 * ensurePublicBucket (s3.ts) and apps/workers' own ensureSearchIndices/
 * ensureHashtagMentionsTable. Exists because of a real gap this migration
 * shipped with initially and only found by testing against a real broker:
 * without it, whichever process (apps/api producing, or apps/workers
 * consuming) happens to touch a topic name first auto-creates it via
 * Redpanda/Kafka's own `auto_create_topics_enabled` — with the *cluster*
 * default partition count (1 on a fresh Redpanda, verified against this
 * repo's own docker-compose.yml instance), silently defeating the
 * `partitionKey`-based partitioning kafka-event-topic.ts/kafka-consumer.ts
 * already do correctly: one partition can't be spread across more than one
 * consumer no matter how carefully messages are keyed into it.
 *
 * Only fixes a topic that doesn't exist yet — kafkajs's own createTopics
 * no-ops (returns `false`, doesn't throw) for one that already does, the
 * same idempotent shape as every other "ensure" in this codebase, but it
 * does NOT retroactively fix a topic some earlier, pre-fix boot already
 * auto-created with the wrong count: growing partitions on a live topic
 * reshuffles which partition an existing key hashes to, which would be a
 * real, disruptive migration of its own, not something safe to automate
 * here. An environment that hit the bug before this existed needs its
 * topics deleted and recreated once by hand.
 */
export async function ensureKafkaTopics(
  kafka: Kafka,
  topics: string[],
  numPartitions: number = DEFAULT_KAFKA_TOPIC_PARTITIONS,
): Promise<void> {
  const admin = kafka.admin()
  await admin.connect()
  try {
    await admin.createTopics({
      topics: topics.map((topic) => ({ topic, numPartitions })),
      waitForLeaders: true,
    })
  } finally {
    await admin.disconnect()
  }
}

// Fixed, well-known consumer group ids (not env vars) — same reasoning as
// SEARCH_INDEXER_CONSUMER_GROUP in search.ts: every apps/workers instance
// must share the same group so Kafka partitions each topic across them,
// instead of each instance replaying every message from scratch.
export const FANOUT_CONSUMER_GROUP = 'x-fanout'
export const NOTIFICATIONS_CONSUMER_GROUP = 'x-notifications'
