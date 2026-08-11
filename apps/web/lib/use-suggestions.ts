'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'

const DEFAULT_LIMIT = 3

/** GET /users/suggestions — "who to follow", backing the empty-timeline state. */
export function useSuggestions(limit: number = DEFAULT_LIMIT) {
  return useQuery({
    queryKey: ['users', 'suggestions', limit],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/users/suggestions', {
        params: { query: { limit } },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}
