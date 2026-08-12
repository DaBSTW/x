'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './api-client'

/**
 * POST /users/{id}/follow. A protected account (ROADMAP.md 2.6) returns
 * `status: 'requested'` instead of an immediate follow — the caller
 * (FollowButton) needs that to show "Solicitud enviada" instead of
 * "Siguiendo". Refreshes suggestions (drop the now-followed/requested
 * account) and the timeline (their posts can now appear, for a real follow).
 */
export function useFollow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await apiClient.POST('/users/{id}/follow', {
        params: { path: { id: userId } },
      })
      if (error) throw new Error(error.error.message)
      return data.data.status
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
