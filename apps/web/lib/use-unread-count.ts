'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'
import { useAuthStore } from './auth-store'

const POLL_INTERVAL_MS = 60_000

/** GET /notifications/unread-count, polled every 60 s (ROADMAP.md 1.7 — WebSocket push lands in phase 2). */
export function useUnreadCount() {
  const accessToken = useAuthStore((state) => state.accessToken)

  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/notifications/unread-count')
      if (error) throw new Error(error.error.message)
      return data.data.count
    },
    enabled: accessToken !== null,
    refetchInterval: POLL_INTERVAL_MS,
  })
}
