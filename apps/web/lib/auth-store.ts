import { create } from 'zustand'

type AuthState = {
  // Access tokens live in memory only, never localStorage — SPECS.md §11.1.
  // The refresh token is an httpOnly cookie the browser attaches automatically.
  accessToken: string | null
  setAccessToken: (accessToken: string | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  setAccessToken: (accessToken) => set({ accessToken }),
}))
