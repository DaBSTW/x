import type { TrendIngestJobData } from '@x/utils'
import type { TrendIngestRepository } from './trend-ingest.repository.js'

export type TrendIngestProcessorDeps = {
  repository: TrendIngestRepository
}

export type TrendIngestProcessor = (data: TrendIngestJobData) => Promise<void>

/**
 * Consumer side of TREND_INGEST_QUEUE_NAME (ROADMAP.md 2.4) — apps/api's
 * posts.service.ts is the producer. Deliberately thin, with no idempotency
 * guard: fan-out's `SET NX` exists because a duplicate delivery there would
 * double-push a follower's timeline, but a duplicate mention row here only
 * costs the next compute-trends run a slightly inflated count for one
 * hashtag in one 5-minute window — self-correcting by the following run,
 * and not worth a dedupe key. Trend scoring was never meant to be exact,
 * only directionally right.
 */
export function createTrendIngestProcessor({
  repository,
}: TrendIngestProcessorDeps): TrendIngestProcessor {
  return async function processTrendIngestJob(data: TrendIngestJobData): Promise<void> {
    await repository.insertMentions(data)
  }
}
