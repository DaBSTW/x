'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'

const PAGE_SIZE = 20

/** GET /notifications, cursor-paginated the same way as everything else (ROADMAP.md 1.7). */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: async ({ pageParam }) => {
      // exactOptionalPropertyTypes: see use-timeline.ts's identical note.
      const query: { limit: number; cursor?: string } = { limit: PAGE_SIZE }
      if (pageParam !== null) query.cursor = pageParam

      const { data, error } = await apiClient.GET('/notifications', { params: { query } })
      if (error) throw new Error(error.error.message)
      return data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.meta.hasMore ? lastPage.meta.nextCursor : null),
  })
}
