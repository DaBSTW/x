import { createApiClient } from '@x/sdk'
import { useAuthStore } from './auth-store'

// Same apps/api, same default — apps/admin isn't a separate backend
// deployment, just a second frontend against the one that already exists.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1'

export const apiClient = createApiClient({
  baseUrl: API_BASE_URL,
  getAccessToken: () => useAuthStore.getState().accessToken,
})
