'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NotificationPreference } from '@x/contracts'
import { apiClient } from './api-client'

const PREFERENCES_KEY = ['notifications', 'preferences']

export function useNotificationPreferences() {
  return useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/notifications/preferences')
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}

/** Optimistic, same shape as use-post-mutations.ts's like/repost/bookmark toggle (SPECS.md §7.3) — a settings checkbox should flip the instant it's clicked, not after a round trip. */
export function useUpdateNotificationPreference() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NotificationPreference) => {
      const { error } = await apiClient.PUT('/notifications/preferences', { body: input })
      if (error) throw new Error(error.error.message)
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: PREFERENCES_KEY })
      const snapshot = queryClient.getQueryData<NotificationPreference[]>(PREFERENCES_KEY)

      queryClient.setQueryData<NotificationPreference[]>(PREFERENCES_KEY, (old) =>
        old?.map((preference) =>
          preference.kind === input.kind && preference.channel === input.channel
            ? { ...preference, enabled: input.enabled }
            : preference,
        ),
      )

      return { snapshot }
    },
    onError: (_error, _input, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(PREFERENCES_KEY, context.snapshot)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY })
    },
  })
}
