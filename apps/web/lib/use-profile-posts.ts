'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { apiClient } from './api-client'

const PAGE_SIZE = 20

export type ProfilePostsFilter = 'posts' | 'replies' | 'media' | 'likes'

/**
 * GET /users/:username/posts, one of <ProfileTabs>'s four filters
 * (ROADMAP.md 1.6). Keyed under the shared `['timeline', …]` prefix so
 * use-post-mutations.ts's like/repost/bookmark optimistic updates apply
 * here too, the same as the home timeline.
 */
export function useProfilePosts(username: string, filter: ProfilePostsFilter) {
  return useInfiniteQuery({
    queryKey: ['timeline', 'profile', username, filter],
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
