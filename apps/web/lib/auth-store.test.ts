import { afterEach, describe, expect, it } from 'vitest'
import { useAuthStore } from './auth-store.js'

describe('useAuthStore', () => {
  afterEach(() => {
    useAuthStore.setState({ accessToken: null })
  })

  it('defaults to no access token', () => {
    expect(useAuthStore.getState().accessToken).toBeNull()
  })

  it('sets and clears the access token', () => {
    useAuthStore.getState().setAccessToken('token-123')
    expect(useAuthStore.getState().accessToken).toBe('token-123')

    useAuthStore.getState().setAccessToken(null)
    expect(useAuthStore.getState().accessToken).toBeNull()
  })
})
