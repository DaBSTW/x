'use client'

import {
  type InfiniteData,
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import type { Post } from '@x/contracts'
import { useRouter } from 'next/navigation'
import { apiClient } from './api-client'

type TimelinePage = {
  data: Post[]
  meta: { nextCursor: string | null; prevCursor: string | null; hasMore: boolean }
}

type ViewerField = 'liked' | 'reposted' | 'bookmarked'
type CounterField = 'likes' | 'reposts'

/**
 * Applies `updater` to every cached post with `postId`, across every
 * timeline-shaped query — today that's only ['timeline', 'home'], but the
 * shared ['timeline'] prefix keeps this working once a profile feed exists.
 */
function updateCachedPost(queryClient: QueryClient, postId: string, updater: (post: Post) => Post) {
  queryClient.setQueriesData<InfiniteData<TimelinePage>>({ queryKey: ['timeline'] }, (old) => {
    if (!old) return old
    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        data: page.data.map((post) => (post.id === postId ? updater(post) : post)),
      })),
    }
  })
}

/**
 * Shared optimistic toggle for like/repost/bookmark (SPECS.md §7.3): flips
 * `viewer[field]` and nudges `counterField` (when the action has a public
 * counter — bookmarks don't) before the request resolves, rolling every
 * touched query back to its snapshot on failure.
 */
function useViewerToggle(options: {
  field: ViewerField
  counterField?: CounterField
  activate: (postId: string) => Promise<void>
  deactivate: (postId: string) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const router = useRouter()

  return useMutation({
    mutationFn: async ({ postId, active }: { postId: string; active: boolean }) => {
      if (active) await options.deactivate(postId)
      else await options.activate(postId)
    },
    onMutate: async ({ postId, active }) => {
      await queryClient.cancelQueries({ queryKey: ['timeline'] })
      const snapshot = queryClient.getQueriesData<InfiniteData<TimelinePage>>({
        queryKey: ['timeline'],
      })

      updateCachedPost(queryClient, postId, (post) => ({
        ...post,
        viewer: {
          liked: false,
          reposted: false,
          bookmarked: false,
          ...post.viewer,
          [options.field]: !active,
        },
        counters: options.counterField
          ? {
              ...post.counters,
              [options.counterField]: post.counters[options.counterField] + (active ? -1 : 1),
            }
          : post.counters,
      }))

      return { snapshot }
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data)
      }
    },
    // updateCachedPost above only ever reaches a post living under the
    // ['timeline'] query prefix (home/bookmarks/lists/profile posts) — a
    // post's own permalink page (app/[username]/status/[id], ROADMAP.md
    // 2.1) is a real Server Component instead: its focused post, every
    // ancestor, and every reply (use-thread-replies.ts's own comment: "not
    // a TanStack query") are server-rendered props with no client cache
    // entry to patch at all, so a like/repost/bookmark there silently never
    // became visible until this. router.refresh() re-runs that server
    // fetch, same fix (and same reasoning) profile-edit-dialog.tsx and
    // thread-reply-composer.tsx already needed for their own Server
    // Component staleness — harmless where it isn't needed too, since RSC
    // refresh and the TanStack Query cache above are separate mechanisms,
    // and refresh() preserves client component state (it isn't a reload).
    onSuccess: () => {
      router.refresh()
    },
  })
}

export function useLike() {
  return useViewerToggle({
    field: 'liked',
    counterField: 'likes',
    activate: async (postId) => {
      const { error } = await apiClient.POST('/posts/{id}/like', {
        params: { path: { id: postId } },
      })
      if (error) throw new Error(error.error.message)
    },
    deactivate: async (postId) => {
      const { error } = await apiClient.DELETE('/posts/{id}/like', {
        params: { path: { id: postId } },
      })
      if (error) throw new Error(error.error.message)
    },
  })
}

export function useRepost() {
  return useViewerToggle({
    field: 'reposted',
    counterField: 'reposts',
    activate: async (postId) => {
      const { error } = await apiClient.POST('/posts/{id}/repost', {
        params: { path: { id: postId } },
      })
      if (error) throw new Error(error.error.message)
    },
    deactivate: async (postId) => {
      const { error } = await apiClient.DELETE('/posts/{id}/repost', {
        params: { path: { id: postId } },
      })
      if (error) throw new Error(error.error.message)
    },
  })
}

export function useBookmark() {
  return useViewerToggle({
    field: 'bookmarked',
    // No public counter for bookmarks — SPECS.md's postCounters intentionally
    // has no `bookmarks` field, the same way the reference product keeps
    // bookmark counts private to the bookmarking user.
    activate: async (postId) => {
      const { error } = await apiClient.POST('/posts/{id}/bookmark', {
        params: { path: { id: postId } },
      })
      if (error) throw new Error(error.error.message)
    },
    deactivate: async (postId) => {
      const { error } = await apiClient.DELETE('/posts/{id}/bookmark', {
        params: { path: { id: postId } },
      })
      if (error) throw new Error(error.error.message)
    },
  })
}
