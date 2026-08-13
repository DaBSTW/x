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
    // use-messages.ts now delivers new messages live over conv:{id} while a
    // chat is actually open (ROADMAP.md 2.5/2.2) — this list view (unread
    // counts/lastMessageAt across every conversation, not just the open
    // one) still doesn't subscribe to anything, a deliberately separate,
    // still-open piece of the same upgrade. Polls like use-unread-count.ts
    // does in the meantime.
    refetchInterval: 30_000,
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
