'use client'

import { useMutation } from '@tanstack/react-query'
import type { LoginRequest, RegisterRequest } from '@x/contracts'
import { apiClient } from './api-client'
import { useAuthStore } from './auth-store'

export function useLogin() {
  const setAccessToken = useAuthStore((state) => state.setAccessToken)

  return useMutation({
    mutationFn: async (input: LoginRequest) => {
      const { data, error } = await apiClient.POST('/auth/login', { body: input })
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
