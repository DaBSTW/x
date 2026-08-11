'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './api-client'

/** GET /conversations (ROADMAP.md 2.5) — a single bounded page for now, no infinite scroll yet (a first DM inbox rarely needs it). */
export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/conversations', {
        params: { query: { limit: 50 } },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    refetchInterval: 30_000, // no WS gateway yet (ROADMAP.md 2.2) — polls like use-unread-count.ts does
  })
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: ['conversations', id],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/conversations', {
        params: { query: { limit: 50 } },
      })
      if (error) throw new Error(error.error.message)
      return data.data.find((c) => c.id === id) ?? null
    },
  })
}

/** POST /conversations — starts (or reuses) a 1:1 by the other person's user id. */
export function useCreateConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { data, error } = await apiClient.POST('/conversations', {
        body: { memberIds: [memberId], isGroup: false },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}
