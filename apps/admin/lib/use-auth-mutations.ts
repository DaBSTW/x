'use client'

import { useMutation } from '@tanstack/react-query'
import type { LoginRequest, TwoFactorLoginRequest } from '@x/contracts'
import { apiClient } from './api-client'
import { useAuthStore } from './auth-store'

// Trimmed relative to apps/web's own lib/use-auth-mutations.ts: no
// register/forgot-password/reset-password/change-password here.
// Moderators are provisioned by hand (packages/db/src/schema/users.ts's
// own comment on isModerator — SQL only, no public sign-up-as-moderator
// path) and are still plain `users` rows, so recovering a forgotten
// password is apps/web's `/forgot-password` job, not a second
// implementation of the same POST /auth/password/* flow here.

/** A correct password on a 2FA account doesn't set a session yet — the caller checks `status` and, on 'requires_two_factor', hands the challengeToken to useTwoFactorLogin below. */
export function useLogin() {
  const setAccessToken = useAuthStore((state) => state.setAccessToken)

  return useMutation({
    mutationFn: async (input: LoginRequest) => {
      const { data, error } = await apiClient.POST('/auth/login', { body: input })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    onSuccess: (data) => {
      if (data.status === 'authenticated') setAccessToken(data.accessToken)
    },
  })
}

/** POST /auth/2fa/login — the second step after useLogin() returns 'requires_two_factor'. */
export function useTwoFactorLogin() {
  const setAccessToken = useAuthStore((state) => state.setAccessToken)

  return useMutation({
    mutationFn: async (input: TwoFactorLoginRequest) => {
      const { data, error } = await apiClient.POST('/auth/2fa/login', { body: input })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    onSuccess: (data) => {
      setAccessToken(data.accessToken)
    },
  })
}

/** Clears the local session and revokes the current server-side one — logout is a real POST, not just a client-side token drop, so the refresh cookie can't be replayed after (auth.service.ts's own logout()). */
export function useLogout() {
  const setAccessToken = useAuthStore((state) => state.setAccessToken)

  return useMutation({
    // auth.routes.ts's own /logout schema declares only `204: z.null()` —
    // no error response at all (it needs no auth and validates nothing
    // that can fail), so openapi-fetch has no error variant to type here,
    // unlike every other mutation in this file. onSettled below clears the
    // local token regardless of how the request actually resolves.
    mutationFn: async () => {
      await apiClient.POST('/auth/logout')
    },
    onSettled: () => {
      setAccessToken(null)
    },
  })
}
