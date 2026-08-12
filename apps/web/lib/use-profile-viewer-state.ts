'use client'

import { useQuery } from '@tanstack/react-query'
import type { ProfileViewerState } from '@x/contracts'
import { apiClient } from './api-client'
import { useAuthStore } from './auth-store'

/**
 * ROADMAP.md 1.6/1.4: `GET /users/{username}`'s `viewer.following/requested`
 * only ever comes back non-empty when the request actually carries an
 * access token. `app/[username]/page.tsx`'s own SSR fetch
 * (`lib/server-api-client.ts`) is deliberately anonymous — its own comment
 * explains why: reusing the browser's token singleton there would share
 * mutable Zustand state across concurrent requests from different users —
 * so the server-rendered `profile` prop never carries `viewer`, even when
 * the visitor is signed in. This is the client-side follow-up fetch that
 * actually can carry the token, same reasoning `useCurrentUser` already
 * established for `isOwnProfile`, just for follow state instead of
 * identity. `<ProfileHeader>` uses this to seed `<FollowButton>`'s initial
 * state instead of it always starting at "Seguir".
 */
export function useProfileViewerState(username: string, enabled: boolean) {
  const accessToken = useAuthStore((state) => state.accessToken)

  return useQuery({
    queryKey: ['users', username, 'viewer-state'],
    queryFn: async (): Promise<ProfileViewerState | null> => {
      const { data, error } = await apiClient.GET('/users/{username}', {
        params: { path: { username } },
      })
      if (error) throw new Error(error.error.message)
      return data.data.viewer ?? null
    },
    enabled: enabled && accessToken !== null,
  })
}
