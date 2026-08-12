'use client'

import type { Post } from '@x/contracts'
import { useState } from 'react'
import { apiClient } from './api-client'

/**
 * <ThreadView>'s "cargar más respuestas" button (ROADMAP.md 2.1) — starts
 * from the page GET /posts/:id/thread already server-rendered, then fetches
 * further pages of GET /posts/:id/replies on demand using that first page's
 * own `nextCursor`. Deliberately not a TanStack useInfiniteQuery: the first
 * page isn't a query this hook owns (it arrived as server-rendered props),
 * and a single post page never needs the cache invalidation/refetch-on-focus
 * the home timeline's infinite query does — this is a one-way "load more"
 * for one view, reset by remounting (see the thread page's `key`) whenever
 * the server-rendered first page itself changes.
 */
export function useThreadReplies(
  postId: string,
  initialReplies: Post[],
  initialCursor: string | null,
) {
  const [replies, setReplies] = useState(initialReplies)
  const [cursor, setCursor] = useState(initialCursor)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadMore(): Promise<void> {
    if (cursor === null || isLoading) return
    setIsLoading(true)
    setError(null)

    const { data, error: fetchError } = await apiClient.GET('/posts/{id}/replies', {
      params: { path: { id: postId }, query: { cursor } },
    })

    setIsLoading(false)
    if (fetchError) {
      setError(fetchError.error.message)
      return
    }
    setReplies((current) => [...current, ...data.data])
    setCursor(data.meta.hasMore ? data.meta.nextCursor : null)
  }

  return { replies, hasMore: cursor !== null, isLoading, error, loadMore }
}
