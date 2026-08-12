'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'
import { useSession } from './use-session'

const PAGE_SIZE = 20

export type ProfilePostsFilter = 'posts' | 'replies' | 'media' | 'likes'

/**
 * GET /users/:username/posts, one of <ProfileTabs>'s four filters
 * (ROADMAP.md 1.6). Keyed under the shared `['timeline', …]` prefix so
 * use-post-mutations.ts's like/repost/bookmark optimistic updates apply
 * here too, the same as the home timeline.
 *
 * `enabled: !isLoading` (not gated on `isAuthenticated`, unlike
 * use-current-user.ts) — this page is reachable by anonymous visitors too,
 * so the query must still run for them. What it can't do is fire *before*
 * providers.tsx's <SessionBootstrap> settles: a protected profile visited
 * by an approved follower would otherwise send the very first request with
 * no access token yet, cache that (wrongly empty) result, and never
 * refetch once the token shows up a moment later — nothing invalidates
 * this query on login. Reusing useSession() here subscribes to the same
 * ['session'] query SessionBootstrap already started, per providers.tsx's
 * own comment ("never double-fetches").
 */
export function useProfilePosts(username: string, filter: ProfilePostsFilter) {
  const { isLoading: isSessionLoading } = useSession()

  return useInfiniteQuery({
    queryKey: ['timeline', 'profile', username, filter],
    enabled: !isSessionLoading,
    queryFn: async ({ pageParam }) => {
      // exactOptionalPropertyTypes: see use-timeline.ts's identical note.
      const query: { limit: number; filter: ProfilePostsFilter; cursor?: string } = {
        limit: PAGE_SIZE,
        filter,
      }
      if (pageParam !== null) query.cursor = pageParam

      const { data, error } = await apiClient.GET('/users/{username}/posts', {
        params: { path: { username }, query },
      })
      if (error) throw new Error(error.error.message)
      return data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.meta.hasMore ? lastPage.meta.nextCursor : null),
  })
}
