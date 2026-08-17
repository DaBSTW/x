import type { RumIngestJobData } from '@x/utils'
import { describe, expect, it } from 'vitest'
import { createRumIngestProcessor } from './rum-ingest.processor.js'
import type { RumIngestRepository } from './rum-ingest.repository.js'

function makeJob(overrides: Partial<RumIngestJobData> = {}): RumIngestJobData {
  return {
    metric: 'LCP',
    value: 1800,
    rating: 'good',
    path: '/[username]',
    navigationType: 'navigate',
    timestampMs: Date.UTC(2026, 0, 1),
    ...overrides,
  }
}

describe('createRumIngestProcessor', () => {
  it('forwards the job straight to the repository', async () => {
    const calls: RumIngestJobData[] = []
    const repository: RumIngestRepository = {
      async insertMetric(data) {
        calls.push(data)
      },
    }
    const process = createRumIngestProcessor({ repository })
    const job = makeJob()

    await process(job)

    expect(calls).toEqual([job])
  })

  it('forwards every metric kind unchanged, not just LCP', async () => {
    const calls: RumIngestJobData[] = []
    const repository: RumIngestRepository = {
      async insertMetric(data) {
        calls.push(data)
      },
    }
    const process = createRumIngestProcessor({ repository })

    const clsJob = makeJob({ metric: 'CLS', value: 0.05, rating: 'good' })
    await process(clsJob)

    expect(calls).toEqual([clsJob])
  })
})
