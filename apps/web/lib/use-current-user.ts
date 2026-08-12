'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './api-client'
import { useAuthStore } from './auth-store'

const CURRENT_USER_KEY = ['users', 'me']

/** The authenticated caller's own profile — GET /users/me. */
export function useCurrentUser() {
  const accessToken = useAuthStore((state) => state.accessToken)

  return useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/users/me')
      if (error) throw new Error(error.error.message)
      return data.data
    },
    enabled: accessToken !== null,
  })
}

/**
 * PATCH /users/me, narrowed to just `isProtected` (ROADMAP.md 2.6) — the
 * only field any UI sets today. `UpdateUserInput`'s other optional fields
 * are typed `T | undefined` (Zod's `.optional()`), which
 * `exactOptionalPropertyTypes` rejects against the SDK's stricter
 * "omitted, never present-as-undefined" body type; a single required
 * boolean has no such ambiguity to hit.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { isProtected: boolean }) => {
      const { data, error } = await apiClient.PATCH('/users/me', { body: input })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(CURRENT_USER_KEY, data)
    },
  })
}
