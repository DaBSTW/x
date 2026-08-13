'use client'

import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import type { Message, RealtimeServerEvent } from '@x/contracts'
import { MESSAGE_CREATED_EVENT, conversationChannel } from '@x/utils/realtime'
import { useCallback } from 'react'
import { apiClient } from './api-client'
import { useRealtimeChannel } from './use-realtime-channel'

const PAGE_SIZE = 30

type MessagesPage = {
  data: Message[]
  meta: { nextCursor: string | null; prevCursor: string | null; hasMore: boolean }
}

function messagesQueryKey(conversationId: string) {
  return ['conversations', conversationId, 'messages']
}

/** GET /conversations/{id}/messages — pages come back newest-first like every other list; callers reverse for chat-style oldest-first display. */
export function useMessages(conversationId: string) {
  const queryClient = useQueryClient()

  // ROADMAP.md 2.5/2.2: conv:{id} was already an authorized, subscribable
  // channel since ws-gateway shipped, but nothing ever published to it —
  // this hook's own refetchInterval below used to be the only delivery
  // mechanism (the comment on it said as much). A live message.created
  // event patches the cache directly (prepended to the first, newest page,
  // never appended to the last one — these pages are newest-first) instead
  // of waiting for the next poll or invalidating and re-fetching.
  useRealtimeChannel(
    conversationChannel(conversationId),
    useCallback(
      (event: RealtimeServerEvent) => {
        if (event.event !== MESSAGE_CREATED_EVENT) return
        const message = event.data as Message
        queryClient.setQueryData<InfiniteData<MessagesPage>>(
          messagesQueryKey(conversationId),
          (old) => {
            if (!old) return old
            const [firstPage, ...restPages] = old.pages
            if (!firstPage) return old
            // The sender's own client already sees this message via
            // useSendMessage's onSuccess invalidation — skip a duplicate
            // insert for them, since this same event reaches every member
            // including the one who just sent it.
            if (firstPage.data.some((existing) => existing.id === message.id)) return old
            return {
              ...old,
              pages: [{ ...firstPage, data: [message, ...firstPage.data] }, ...restPages],
            }
          },
        )
      },
      [queryClient, conversationId],
    ),
  )

  return useInfiniteQuery({
    queryKey: messagesQueryKey(conversationId),
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
    // A safety net now, not the primary delivery mechanism — conv:{id}'s
    // own WS channel above delivers new messages live; this only catches
    // whatever a connection that never established, or silently dropped,
    // missed. Same order-of-magnitude slowdown use-conversations.ts's own
    // list poll already settled on once its own WS coverage lands.
    refetchInterval: 30_000,
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
