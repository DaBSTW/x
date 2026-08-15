'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'

/** GET /users/:username — the same public profile lookup apps/web's own [username] route page uses, reused here as account search's "resolve a handle to an id" step (moderation actions/trust-score both take a numeric id, not a username). */
export function useUserByUsername(username: string | null) {
  return useQuery({
    queryKey: ['users', 'by-username', username],
    queryFn: async () => {
      if (!username) return null
      const { data, error } = await apiClient.GET('/users/{username}', {
        params: { path: { username } },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    enabled: username !== null && username.length > 0,
    retry: false,
  })
}

/** GET /moderation/users/:id/trust-score — ROADMAP.md 3.3e, moderator-only. */
export function useTrustScore(userId: string | null) {
  return useQuery({
    queryKey: ['moderation', 'users', userId, 'trust-score'],
    queryFn: async () => {
      if (!userId) return null
      const { data, error } = await apiClient.GET('/moderation/users/{id}/trust-score', {
        params: { path: { id: userId } },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    enabled: userId !== null,
    retry: false,
  })
}
