'use client'

import { useQuery } from '@tanstack/react-query'
import type { ModerationTargetType } from '@x/contracts'
import { apiClient } from './api-client'

/** GET /moderation/actions — the global, newest-first feed (packages/db's idx_moderation_actions_created). Every action ever taken, human or system (ROADMAP.md 3.3d/3.3f's classifiers), immutable by construction (moderation_actions has no update/delete). */
export function useActionsHistory(limit = 50) {
  return useQuery({
    queryKey: ['moderation', 'actions', limit],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/moderation/actions', {
        params: { query: { limit } },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}

/** GET /moderation/targets/:targetType/:targetId/actions — one account or post's own history, used by the account-search page. */
export function useTargetActions(targetType: ModerationTargetType, targetId: string | null) {
  return useQuery({
    queryKey: ['moderation', 'targets', targetType, targetId, 'actions'],
    queryFn: async () => {
      if (!targetId) return []
      const { data, error } = await apiClient.GET(
        '/moderation/targets/{targetType}/{targetId}/actions',
        { params: { path: { targetType, targetId } } },
      )
      if (error) throw new Error(error.error.message)
      return data.data
    },
    enabled: targetId !== null,
  })
}
