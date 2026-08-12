'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './api-client'

const SESSIONS_KEY = ['auth', 'sessions']

export function useSessions() {
  return useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/auth/sessions')
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}

/** ROADMAP.md 2.6 — revoke one of the caller's own sessions by id (e.g. a lost device), without logging every device out. */
export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient.DELETE('/auth/sessions/{id}', { params: { path: { id } } })
      if (error) throw new Error(error.error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY })
    },
  })
}
