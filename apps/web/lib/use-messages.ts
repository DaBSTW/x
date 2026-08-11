'use client'

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './api-client'

const PAGE_SIZE = 30

/** GET /conversations/{id}/messages — pages come back newest-first like every other list; callers reverse for chat-style oldest-first display. */
export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: ['conversations', conversationId, 'messages'],
    queryFn: async ({ pageParam }) => {
      const query: { limit: number; cursor?: string } = { limit: PAGE_SIZE }
      if (pageParam !== null) query.cursor = pageParam

      const { data, error } = await apiClient.GET('/conversations/{id}/messages', {
        params: { path: { id: conversationId }, query },
      })
      if (error) throw new Error(error.error.message)
      return data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.meta.hasMore ? lastPage.meta.nextCursor : null),
    refetchInterval: 5_000, // no WS gateway yet (ROADMAP.md 2.2) — short poll while a chat is open
  })
}

export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (text: string) => {
      const { data, error } = await apiClient.POST('/conversations/{id}/messages', {
        params: { path: { id: conversationId } },
        body: { text },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', conversationId, 'messages'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

export function useMarkRead(conversationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await apiClient.POST('/conversations/{id}/read', {
        params: { path: { id: conversationId } },
        body: { messageId },
      })
      if (error) throw new Error(error.error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}
