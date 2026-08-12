'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './api-client'

const FOLLOW_REQUESTS_KEY = ['users', 'me', 'follow-requests']

/** GET /users/me/follow-requests (ROADMAP.md 2.6) — bounded first page, same as use-follow.ts's suggestions; no "load more" UI yet. */
export function useFollowRequests() {
  return useQuery({
    queryKey: FOLLOW_REQUESTS_KEY,
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/users/me/follow-requests', {
        params: { query: { limit: 50 } },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}

export function useAcceptFollowRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (requesterId: string) => {
      const { error } = await apiClient.POST('/users/me/follow-requests/{id}/accept', {
        params: { path: { id: requesterId } },
      })
      if (error) throw new Error(error.error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FOLLOW_REQUESTS_KEY })
    },
  })
}

export function useRejectFollowRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (requesterId: string) => {
      const { error } = await apiClient.DELETE('/users/me/follow-requests/{id}', {
        params: { path: { id: requesterId } },
      })
      if (error) throw new Error(error.error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FOLLOW_REQUESTS_KEY })
    },
  })
}
