'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './api-client'

const TWO_FACTOR_STATUS_KEY = ['auth', '2fa', 'status']

/** GET /auth/2fa (ROADMAP.md 2.6) — whether the caller's account currently requires a code at login. */
export function useTwoFactorStatus() {
  return useQuery({
    queryKey: TWO_FACTOR_STATUS_KEY,
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/auth/2fa')
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}

/** POST /auth/2fa/setup — a fresh secret + QR, awaiting useConfirmTwoFactor below. Doesn't touch the status query: setup alone doesn't enable anything yet. */
export function useSetupTwoFactor() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await apiClient.POST('/auth/2fa/setup')
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}

/** POST /auth/2fa/verify — confirms the pending secret and returns one-time recovery codes, shown exactly once by the caller. */
export function useConfirmTwoFactor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await apiClient.POST('/auth/2fa/verify', { body: { code } })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    onSuccess: () => {
      queryClient.setQueryData(TWO_FACTOR_STATUS_KEY, { enabled: true })
    },
  })
}

/** DELETE /auth/2fa — requires the current password (auth.service.ts). */
export function useDisableTwoFactor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (currentPassword: string) => {
      const { error } = await apiClient.DELETE('/auth/2fa', { body: { currentPassword } })
      if (error) throw new Error(error.error.message)
    },
    onSuccess: () => {
      queryClient.setQueryData(TWO_FACTOR_STATUS_KEY, { enabled: false })
    },
  })
}
