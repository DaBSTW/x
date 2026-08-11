'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './api-client'

/** POST /notifications/read, up to a given notification id — invalidates both the list and the unread badge, so the 60 s poll isn't the only thing that clears it. */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (cursor: string) => {
      const { error } = await apiClient.POST('/notifications/read', { body: { cursor } })
      if (error) throw new Error(error.error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}
