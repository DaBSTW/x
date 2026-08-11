'use client'

import { PostCard } from '@/components/post-card'
import { TimelineSkeleton } from '@/components/timeline-skeleton'
import { type ProfilePostsFilter, useProfilePosts } from '@/lib/use-profile-posts'
import { useEffect, useRef } from 'react'

const EMPTY_MESSAGES: Record<ProfilePostsFilter, string> = {
  posts: 'Todavía no hay posts.',
  replies: 'Todavía no hay respuestas.',
  media: 'Todavía no hay imágenes.',
  likes: 'Todavía no hay me gusta.',
}

type ProfilePostListProps = {
  username: string
  filter: ProfilePostsFilter
}

/** One <ProfileTabs> pane — same useInfiniteQuery shape as <Timeline>, but a plain IntersectionObserver sentinel instead of window-virtualizing: a single profile's feed is bounded in a way the global home timeline isn't. */
export function ProfilePostList({ username, filter }: ProfilePostListProps) {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useProfilePosts(username, filter)
  const posts = data?.pages.flatMap((page) => page.data) ?? []

  const sentinelRef = useRef<HTMLDivElement>(null)

  // Scroll-triggered pagination is DOM plumbing reacting to layout, not a
  // data-fetching effect itself — same carve-out as <Timeline>'s virtualizer
  // trigger (CODESTYLE.md §11).
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasNextPage || isFetchingNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) fetchNextPage()
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isLoading) return <TimelineSkeleton />
  if (isError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        No se pudo cargar. Inténtalo de nuevo más tarde.
      </p>
    )
  }
  if (posts.length === 0) {
    return (
      <p className="p-10 text-center text-sm text-muted-foreground">{EMPTY_MESSAGES[filter]}</p>
    )
  }

  return (
    <div role="feed" aria-busy={isFetchingNextPage} aria-label="Posts del perfil">
      {posts.map((post, index) => (
        <div key={post.id} aria-posinset={index + 1} aria-setsize={hasNextPage ? -1 : posts.length}>
          <PostCard post={post} />
        </div>
      ))}
      <div ref={sentinelRef} />
      {isFetchingNextPage && (
        <p className="p-4 text-center text-sm text-muted-foreground">Cargando más…</p>
      )}
    </div>
  )
}
