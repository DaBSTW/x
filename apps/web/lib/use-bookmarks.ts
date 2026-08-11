'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'

const PAGE_SIZE = 20

/** GET /timeline/bookmarks, paged with useInfiniteQuery (ROADMAP.md 2.8) — same shape as useTimeline. */
export function useBookmarks() {
  return useInfiniteQuery({
    queryKey: ['timeline', 'bookmarks'],
    queryFn: async ({ pageParam }) => {
      // See use-timeline.ts's identical comment: exactOptionalPropertyTypes
      // needs the key absent, not present-with-undefined.
      const query: { limit: number; cursor?: string } = { limit: PAGE_SIZE }
      if (pageParam !== null) query.cursor = pageParam

      const { data, error } = await apiClient.GET('/timeline/bookmarks', { params: { query } })
      if (error) throw new Error(error.error.message)
      return data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.meta.hasMore ? lastPage.meta.nextCursor : null),
  })
}
