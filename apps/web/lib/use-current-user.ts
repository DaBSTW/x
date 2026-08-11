'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'
import { useAuthStore } from './auth-store'

/** The authenticated caller's own profile — GET /users/me. */
export function useCurrentUser() {
  const accessToken = useAuthStore((state) => state.accessToken)

  return useQuery({
    queryKey: ['users', 'me'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/users/me')
      if (error) throw new Error(error.error.message)
      return data.data
    },
    enabled: accessToken !== null,
  })
}
