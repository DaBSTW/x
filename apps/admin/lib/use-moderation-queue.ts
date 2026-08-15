'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApplyModerationActionRequest } from '@x/contracts'
import { apiClient } from './api-client'

const REPORTS_QUEUE_KEY = ['moderation', 'reports']
// The shared prefix every moderation-related query key in this app starts
// with (use-moderation-history.ts's two hooks, use-account-search.ts's
// useTrustScore) — invalidating this one prefix below, rather than
// enumerating each hook's own key by hand, means a new moderation query
// added later is covered automatically instead of silently going stale.
const MODERATION_KEY_PREFIX = ['moderation']

/** GET /moderation/reports — SPECS.md §12.1's reactive-layer review queue, already sorted most-urgent-first by moderation.repository.ts's own idx_reports_queue (status, priority desc, createdAt). */
export function useReportsQueue(status: 'pending' | 'reviewing' = 'pending') {
  return useQuery({
    queryKey: [...REPORTS_QUEUE_KEY, status],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/moderation/reports', {
        params: { query: { status, limit: 50 } },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}

/**
 * POST /moderation/actions — a moderator applying a graduated action by
 * hand. Invalidates every moderation query (the acted-on report leaves the
 * pending queue, moderation.service.ts's own applyModerationAction marks
 * it resolved; the global history feed and this target's own history both
 * gain a fresh row; a fresh action against a user can also move their own
 * trust score, computeTrustScore's own actionedCount penalty) rather than
 * just the queue — a moderator acting on the same account twice in one
 * page session should see the second action's effects immediately, not
 * only after a manual re-search.
 */
export function useApplyModerationAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: ApplyModerationActionRequest) => {
      // ApplyModerationActionRequest (Zod's z.infer) types reportId/
      // durationHours as `T | undefined`, one level looser than the SDK's
      // generated body type (`T` behind an optional key, no explicit
      // `undefined`) — exactOptionalPropertyTypes rejects passing the
      // former where the latter is expected, same gap
      // moderation.routes.ts's own conditional-spread fix already covers
      // on the backend. Rebuilding the body here, instead of forwarding
      // `input` as-is, keeps an explicitly-undefined key from ever reaching
      // the wire either way.
      const { data, error } = await apiClient.POST('/moderation/actions', {
        body: {
          targetType: input.targetType,
          targetId: input.targetId,
          action: input.action,
          reason: input.reason,
          policy: input.policy,
          ...(input.reportId !== undefined && { reportId: input.reportId }),
          ...(input.durationHours !== undefined && { durationHours: input.durationHours }),
        },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MODERATION_KEY_PREFIX })
    },
  })
}
