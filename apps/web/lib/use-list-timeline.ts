'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'

const PAGE_SIZE = 20

/** GET /timeline/list/{id}, paged with useInfiniteQuery (ROADMAP.md 2.8) — same shape as useTimeline/useBookmarks. */
export function useListTimeline(listId: string) {
  return useInfiniteQuery({
    queryKey: ['timeline', 'list', listId],
    queryFn: async ({ pageParam }) => {
      const query: { limit: number; cursor?: string } = { limit: PAGE_SIZE }
      if (pageParam !== null) query.cursor = pageParam

      const { data, error } = await apiClient.GET('/timeline/list/{id}', {
        params: { path: { id: listId }, query },
      })
      if (error) throw new Error(error.error.message)
      return data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.meta.hasMore ? lastPage.meta.nextCursor : null),
  })
}
