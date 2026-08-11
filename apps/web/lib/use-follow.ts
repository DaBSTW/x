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

/** DELETE /users/{id}/follow — <FollowButton>'s other half. No suggestions refresh: an unfollowed account isn't a suggestion candidate either way. */
export function useUnfollow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await apiClient.DELETE('/users/{id}/follow', {
        params: { path: { id: userId } },
      })
      if (error) throw new Error(error.error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline', 'home'] })
    },
  })
}
