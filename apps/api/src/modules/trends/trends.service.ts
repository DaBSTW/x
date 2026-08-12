import type { Trend } from '@x/contracts'
import { GLOBAL_TREND_SCOPE } from '@x/utils'
import type { TrendsRepository } from './trends.repository.js'

export type TrendsService = ReturnType<typeof createTrendsService>

export function createTrendsService(repository: TrendsRepository) {
  return {
    /** `lang` omitted (or not one detectLanguage/compute-trends.ts ever segmented) falls back to the always-computed GLOBAL_TREND_SCOPE — there's no "unknown language" 404 here, just fewer or no results, same posture as the repository layer's own "unknown scope → empty list". */
    async listTrends(lang: string | undefined, limit: number): Promise<Trend[]> {
      const rows = await repository.listTopByScope(lang ?? GLOBAL_TREND_SCOPE, limit)
      return rows
    },
  }
}
