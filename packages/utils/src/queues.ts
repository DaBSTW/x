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

// ROADMAP.md 3.4g / SPECS.md §14 — real-user-monitoring for Core Web
// Vitals (LCP < 2.5 s, INP < 200 ms, CLS < 0.1). apps/web's browser-side
// reporter (lib/report-web-vitals.ts) POSTs one of these per metric to
// apps/api's unauthenticated POST /v1/rum (a page can be measured before
// the visitor ever logs in — the landing page 3.4f's own bundle budget
// targets is exactly one of those), which enqueues here; apps/workers'
// rum-ingest consumer writes them to ClickHouse, the same "apps/api
// produces, apps/workers owns the actual write" split trend-ingest above
// already uses.
export const RUM_INGEST_QUEUE_NAME = 'rum-ingest'

// The five metrics the standard `web-vitals` library (and Next.js's own
// useReportWebVitals, a thin wrapper over it) reports — FID included
// despite being superseded by INP in the Core Web Vitals set itself
// (SPECS.md §14 doesn't name it), since Next.js's hook still measures it
// and there's no reason to discard a free, real signal at ingestion time.
export type RumMetricName = 'CLS' | 'FCP' | 'FID' | 'INP' | 'LCP' | 'TTFB'
export type RumRating = 'good' | 'needs-improvement' | 'poor'

export type RumIngestJobData = {
  metric: RumMetricName
  value: number
  rating: RumRating
  // The route pattern (e.g. "/[username]"), never the concrete URL —
  // apps/web's reporter strips both the origin and any dynamic segment's
  // real value before this ever leaves the browser, matching this
  // ClickHouse table's own posture (analytics-only, ROADMAP.md 2.4's own
  // docker-compose.yml comment on that instance) of never carrying
  // anything that identifies a specific user or resource.
  path: string
  navigationType: string
  timestampMs: number
}
