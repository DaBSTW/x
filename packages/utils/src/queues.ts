// Shared between apps/api (producer) and apps/workers (consumer) — the job
// payload shape is the contract between two separate processes, so it can't
// live in either one alone.

// Kafka since ROADMAP.md 3.1 (kafka-events.ts's POST_CREATED_TOPIC) — this
// was BullMQ's queue name before that migration; FanoutJobData itself is
// unchanged, only the transport moved.
export type FanoutJobData = {
  postId: string
  authorId: string
}

// ROADMAP.md 2.4 — apps/api enqueues one of these per post that has at
// least one hashtag; apps/workers' trend-ingest consumer writes them to
// ClickHouse. Only hashtags travel here, never the post's own text: the
// scoring job (SPECS.md §10.4) only ever counts hashtag occurrences, so
// there's nothing else for ingestion to carry.
export const TREND_INGEST_QUEUE_NAME = 'trend-ingest'

export type TrendIngestJobData = {
  postId: string
  authorId: string
  hashtags: string[]
  // Milliseconds since epoch, extracted from the post's own Snowflake id
  // (extractTimestamp) rather than re-read with `Date.now()` at enqueue
  // time — the two are only ever a few ms apart, but the id's timestamp is
  // the one number every other reader of this post already agrees is "when
  // it was created."
  createdAtMs: number
  // null when detectLanguage (packages/utils/src/language.ts) couldn't
  // classify the post's text — the ingested row still counts toward the
  // hashtag's global stats, just not toward any per-language segment.
  lang: string | null
}
