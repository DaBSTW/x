import type { RumIngestJobData } from '@x/utils'
import type { RumIngestRepository } from './rum-ingest.repository.js'

export type RumIngestProcessorDeps = {
  repository: RumIngestRepository
}

export type RumIngestProcessor = (data: RumIngestJobData) => Promise<void>

/**
 * Consumer side of RUM_INGEST_QUEUE_NAME (ROADMAP.md 3.4g) — apps/api's
 * rum.routes.ts is the producer. Deliberately thin and, like
 * trend-ingest.processor.ts, with no idempotency guard: a duplicate metric
 * report only inflates one sample count in an aggregate analytics table,
 * never a correctness problem worth a dedupe key over.
 */
export function createRumIngestProcessor({
  repository,
}: RumIngestProcessorDeps): RumIngestProcessor {
  return async function processRumIngestJob(data: RumIngestJobData): Promise<void> {
    await repository.insertMetric(data)
  }
}
