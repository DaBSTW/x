import type { TrendIngestJobData } from '@x/utils'
import { describe, expect, it } from 'vitest'
import { createTrendIngestProcessor } from './trend-ingest.processor.js'
import type { TrendIngestRepository } from './trend-ingest.repository.js'

function makeJob(overrides: Partial<TrendIngestJobData> = {}): TrendIngestJobData {
  return {
    postId: '1',
    authorId: '2',
    hashtags: ['mundial'],
    createdAtMs: Date.UTC(2026, 0, 1),
    lang: 'es',
    ...overrides,
  }
}

describe('createTrendIngestProcessor', () => {
  it('forwards the job straight to the repository', async () => {
    const calls: TrendIngestJobData[] = []
    const repository: TrendIngestRepository = {
      async insertMentions(data) {
        calls.push(data)
      },
    }
    const process = createTrendIngestProcessor({ repository })
    const job = makeJob()

    await process(job)

    expect(calls).toEqual([job])
  })

  it('still calls the repository for a job with no hashtags — insertMentions itself is the no-op', async () => {
    // A post's own hashtag filter (posts.service.ts only enqueues when
    // hashtags.length > 0) means this shouldn't happen in production, but
    // the processor doesn't special-case it either — insertMentions already
    // no-ops on an empty array, so there's nothing for this layer to guard.
    const calls: TrendIngestJobData[] = []
    const repository: TrendIngestRepository = {
      async insertMentions(data) {
        calls.push(data)
      },
    }
    const process = createTrendIngestProcessor({ repository })

    await process(makeJob({ hashtags: [] }))

    expect(calls).toHaveLength(1)
  })
})
