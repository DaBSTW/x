'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './api-client'

/** POST /users/{id}/follow. Refreshes suggestions (drop the now-followed account) and the timeline (their posts can now appear). */
export function useFollow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await apiClient.POST('/users/{id}/follow', {
        params: { path: { id: userId } },
      })
      if (error) throw new Error(error.error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', 'suggestions'] })
      queryClient.invalidateQueries({ queryKey: ['timeline', 'home'] })
    },
  })
}
