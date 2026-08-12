'use client'

import { PostFeedList } from '@/components/post-feed-list'
import { useCurrentUser } from '@/lib/use-current-user'
import { useTimeline } from '@/lib/use-timeline'
import { useTimelineNewPosts } from '@/lib/use-timeline-new-posts'
import { EmptyTimeline } from './empty-timeline'
import { TimelineSkeleton } from './timeline-skeleton'
import { Button } from './ui/button'

export function Timeline() {
  const { data: me } = useCurrentUser()
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useTimeline()
  const { count: newPostsCount, reset: resetNewPosts } = useTimelineNewPosts(me?.id)
  const posts = data?.pages.flatMap((page) => page.data) ?? []

  if (isLoading) return <TimelineSkeleton />
  if (isError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        No se pudo cargar el timeline. Inténtalo de nuevo más tarde.
      </p>
    )
  }

  function onShowNewPosts() {
    resetNewPosts()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    void refetch()
  }

  return (
    <>
      {newPostsCount > 0 && (
        <div className="sticky top-0 z-10 flex justify-center border-b border-border bg-background/95 p-2 backdrop-blur">
          <Button type="button" variant="outline" size="sm" onClick={onShowNewPosts}>
            {newPostsCount === 1 ? '1 post nuevo' : `${newPostsCount} posts nuevos`}
          </Button>
        </div>
      )}
      {posts.length === 0 ? (
        <EmptyTimeline />
      ) : (
        <PostFeedList
          posts={posts}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          ariaLabel="Timeline"
        />
      )}
    </>
  )
}
