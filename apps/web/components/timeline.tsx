'use client'

import { PostFeedList } from '@/components/post-feed-list'
import { useCurrentUser } from '@/lib/use-current-user'
import { useTimeline } from '@/lib/use-timeline'
import { useTimelineNewPosts } from '@/lib/use-timeline-new-posts'
import { useEffect, useRef, useState } from 'react'
import { EmptyTimeline } from './empty-timeline'
import { TimelineSkeleton } from './timeline-skeleton'
import { Button } from './ui/button'

export function Timeline() {
  const { data: me } = useCurrentUser()
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useTimeline()
  const { count: newPostsCount, reset: resetNewPosts } = useTimelineNewPosts(me?.id)
  const posts = data?.pages.flatMap((page) => page.data) ?? []

  // ROADMAP.md 1.8/2.2: the sticky button below is a new DOM node quietly
  // appearing, which a screen reader has no reason to notice on its own —
  // same "DOM plumbing reacting to already-arrived data" category as
  // post-feed-list.tsx's own pagination announcement, mirrored here for the
  // one case that note explicitly left open ("no cubre posts... de otras
  // cuentas apareciendo en vivo") back when there was no realtime mechanism
  // to hang it on yet. Only fires on an *increase* — resetNewPosts (the
  // button's own click handler) intentionally doesn't announce anything
  // itself, since post-feed-list.tsx already announces the refetch that follows.
  const previousNewPostsCountRef = useRef(newPostsCount)
  const [newPostsAnnouncement, setNewPostsAnnouncement] = useState('')
  useEffect(() => {
    if (newPostsCount > previousNewPostsCountRef.current) {
      setNewPostsAnnouncement(
        newPostsCount === 1
          ? '1 post nuevo disponible.'
          : `${newPostsCount} posts nuevos disponibles.`,
      )
    }
    previousNewPostsCountRef.current = newPostsCount
  }, [newPostsCount])

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
      <p aria-live="polite" className="sr-only">
        {newPostsAnnouncement}
      </p>
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
