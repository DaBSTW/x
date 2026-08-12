'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'

export type UseTrendsOptions = {
  /** ISO 639-1 code — omitted asks for the global (all-languages) scope. */
  lang?: string
  limit?: number
}

/** GET /trends (ROADMAP.md 2.4) — public, so this works whether or not useSession has resolved yet, same posture as the marketing pages' own queries. */
export function useTrends(options: UseTrendsOptions = {}) {
  const { lang, limit } = options
  return useQuery({
    queryKey: ['trends', lang ?? 'global', limit ?? 10],
    queryFn: async () => {
      // exactOptionalPropertyTypes: the generated query type is `lang?:
      // string`, not `string | undefined` — the key must be absent, never
      // present-with-undefined (same reasoning as use-timeline.ts's cursor).
      const query: { lang?: string; limit?: number } = {}
      if (lang !== undefined) query.lang = lang
      if (limit !== undefined) query.limit = limit

      const { data, error } = await apiClient.GET('/trends', { params: { query } })
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}
