'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'

const PAGE_SIZE = 20

/** GET /timeline/home, paged with useInfiniteQuery per SPECS.md §7.2. */
export function useTimeline() {
  return useInfiniteQuery({
    queryKey: ['timeline', 'home'],
    queryFn: async ({ pageParam }) => {
      // exactOptionalPropertyTypes: the generated query type is `cursor?:
      // string`, not `string | undefined` — the key must be absent, never
      // present-with-undefined, so this is a real conditional assignment
      // rather than `cursor: pageParam ?? undefined`.
      const query: { limit: number; cursor?: string } = { limit: PAGE_SIZE }
      if (pageParam !== null) query.cursor = pageParam

      const { data, error } = await apiClient.GET('/timeline/home', { params: { query } })
      if (error) throw new Error(error.error.message)
      return data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.meta.hasMore ? lastPage.meta.nextCursor : null),
  })
}
