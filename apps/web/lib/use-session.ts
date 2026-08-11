'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'
import { useAuthStore } from './auth-store'

/**
 * Bootstraps the session from the httpOnly refresh cookie on load — a
 * TanStack Query, not a raw `useEffect`, per CODESTYLE.md §11 ("ningún
 * `useEffect` para obtener datos").
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
