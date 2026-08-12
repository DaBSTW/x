'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateUserInput } from '@x/contracts'
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
 * `UpdateUserInput` (packages/contracts, from Zod's `.optional()`) types
 * every field `T | undefined` — the SDK's generated body type is stricter,
 * "absent or present," never "present-as-undefined", which
 * `exactOptionalPropertyTypes` enforces at the call to `apiClient.PATCH`
 * below. Callers of `useUpdateProfile` build a normal `UpdateUserInput`
 * (only setting the keys they mean to change, same as every other caller
 * in this codebase already does — protected-account-toggle.tsx's
 * `{isProtected: value}`); this drops any key that's still `undefined`
 * before it reaches the SDK, so the object's actual shape matches what it
 * was always going to be at runtime anyway.
 */
function stripUndefined<T extends Record<string, unknown>>(
  input: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) result[key] = value
  }
  return result as { [K in keyof T]?: Exclude<T[K], undefined> }
}

/** PATCH /users/me (ROADMAP.md 1.6/2.5/2.6) — see stripUndefined above for why the body isn't passed straight through. */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateUserInput) => {
      const { data, error } = await apiClient.PATCH('/users/me', { body: stripUndefined(input) })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(CURRENT_USER_KEY, data)
    },
  })
}
