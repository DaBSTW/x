'use client'

import { PostFeedList } from '@/components/post-feed-list'
import { useBookmarks } from '@/lib/use-bookmarks'
import { TimelineSkeleton } from './timeline-skeleton'

export function BookmarksFeed() {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useBookmarks()
  const posts = data?.pages.flatMap((page) => page.data) ?? []

  if (isLoading) return <TimelineSkeleton />
  if (isError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        No se pudieron cargar tus guardados. Inténtalo de nuevo más tarde.
      </p>
    )
  }
  if (posts.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        Todavía no has guardado ningún post.
      </p>
    )
  }

  return (
    <PostFeedList
      posts={posts}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      fetchNextPage={fetchNextPage}
      ariaLabel="Guardados"
    />
  )
}
