import { GLOBAL_TREND_SCOPE } from '@x/utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TrendRow, TrendsRepository } from './trends.repository.js'
import { createTrendsService } from './trends.service.js'

describe('createTrendsService', () => {
  let snapshotsByScope: Map<string, TrendRow[]>
  let repository: TrendsRepository
  let requestedScopes: string[]

  beforeEach(() => {
    snapshotsByScope = new Map()
    requestedScopes = []
    repository = {
      async listTopByScope(scope, limit) {
        requestedScopes.push(scope)
        return (snapshotsByScope.get(scope) ?? []).slice(0, limit)
      },
    }
  })

  it('falls back to GLOBAL_TREND_SCOPE when no lang is given', async () => {
    snapshotsByScope.set(GLOBAL_TREND_SCOPE, [
      { hashtag: 'mundial', score: 5, postCount1h: 100, uniqueAuthors1h: 60 },
    ])
    const service = createTrendsService(repository)

    const trends = await service.listTrends(undefined, 10)

    expect(requestedScopes).toEqual([GLOBAL_TREND_SCOPE])
    expect(trends).toEqual([
      { hashtag: 'mundial', score: 5, postCount1h: 100, uniqueAuthors1h: 60 },
    ])
  })

  it('queries the language-specific scope when lang is given', async () => {
    snapshotsByScope.set('es', [
      { hashtag: 'mundial', score: 5, postCount1h: 100, uniqueAuthors1h: 60 },
    ])
    const service = createTrendsService(repository)

    await service.listTrends('es', 10)

    expect(requestedScopes).toEqual(['es'])
  })

  it('returns an empty list, not an error, for a scope with no snapshot yet', async () => {
    const service = createTrendsService(repository)

    await expect(service.listTrends('fr', 10)).resolves.toEqual([])
  })

  it('forwards the limit through to the repository', async () => {
    snapshotsByScope.set(GLOBAL_TREND_SCOPE, [
      { hashtag: 'uno', score: 3, postCount1h: 100, uniqueAuthors1h: 60 },
      { hashtag: 'dos', score: 2, postCount1h: 100, uniqueAuthors1h: 60 },
    ])
    const service = createTrendsService(repository)

    const trends = await service.listTrends(undefined, 1)

    expect(trends).toHaveLength(1)
  })
})
