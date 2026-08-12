'use client'

import { useMutation } from '@tanstack/react-query'
import type {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  TwoFactorLoginRequest,
} from '@x/contracts'
import { apiClient } from './api-client'
import { useAuthStore } from './auth-store'

/** A correct password on a 2FA account (ROADMAP.md 2.6) doesn't set a session yet — the caller checks `status` and, on 'requires_two_factor', hands the challengeToken to useTwoFactorLogin below. */
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

/** POST /auth/2fa/login — the second step after useLogin() returns 'requires_two_factor'; `code` may be a live TOTP or one of the recovery codes shown at setup. */
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

export function useRegister() {
  return useMutation({
    mutationFn: async (input: RegisterRequest) => {
      const { data, error } = await apiClient.POST('/auth/register', { body: input })
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}

/** Always resolves — the API returns `{sent: true}` whether or not the email is registered (SPECS.md §11.3). */
export function useForgotPassword() {
  return useMutation({
    mutationFn: async (input: ForgotPasswordRequest) => {
      const { data, error } = await apiClient.POST('/auth/password/forgot', { body: input })
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (input: ResetPasswordRequest) => {
      const { data, error } = await apiClient.POST('/auth/password/reset', { body: input })
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}

/** Authenticated — keeps the current session alive and revokes every other one (auth.service.ts). */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: ChangePasswordRequest) => {
      const { data, error } = await apiClient.POST('/auth/password/change', { body: input })
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}
