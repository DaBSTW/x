'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'
import { useAuthStore } from './auth-store'

/**
 * Bootstraps the session from the httpOnly refresh cookie on load — a
 * TanStack Query, not a raw `useEffect`, per CODESTYLE.md §11. Same as
 * apps/web's own lib/use-session.ts.
 *
 * This only proves the caller is *logged in*, not that they're a
 * moderator — `users.isModerator` (packages/db/src/schema/users.ts) is
 * never serialized to any API response (moderation.routes.ts's own
 * requireModerator checks it server-side per request instead), so there's
 * nothing for this hook to read client-side either. (app)/layout.tsx below
 * gates on this; each page's own moderator-only query surfaces a 403 with
 * its own "no tienes acceso de moderador" message instead of a second,
 * redundant gate here.
 */
export function useSession() {
  const accessToken = useAuthStore((state) => state.accessToken)
  const setAccessToken = useAuthStore((state) => state.setAccessToken)

  const query = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const { data, error } = await apiClient.POST('/auth/refresh')
      if (error) {
        setAccessToken(null)
        return null
      }
      setAccessToken(data.data.accessToken)
      return data.data
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  return {
    isLoading: query.isLoading,
    isAuthenticated: accessToken !== null,
  }
}
