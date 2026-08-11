'use client'

import { PostCard } from '@/components/post-card'
import { useTimeline } from '@/lib/use-timeline'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import { EmptyTimeline } from './empty-timeline'
import { TimelineSkeleton } from './timeline-skeleton'

/**
 * useInfiniteQuery + useVirtualizer, per SPECS.md §7.2 — window-scrolled
 * (the app shell has no fixed-height scroll container), overscan 5.
 */
export function Timeline() {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useTimeline()
  const posts = data?.pages.flatMap((page) => page.data) ?? []

  const containerRef = useRef<HTMLDivElement>(null)
  // useWindowVirtualizer measures scroll position against the whole window,
  // so it needs to know how far this container sits from the top of the
  // page — otherwise every item renders offset by that amount.
  const [scrollMargin, setScrollMargin] = useState(0)
  useEffect(() => {
    setScrollMargin(containerRef.current?.offsetTop ?? 0)
  }, [])

  const virtualizer = useWindowVirtualizer({
    count: posts.length,
    estimateSize: () => 120,
    overscan: 5,
    scrollMargin,
  })
  const items = virtualizer.getVirtualItems()
  const lastIndex = items.at(-1)?.index

  // Standard tanstack-virtual infinite-scroll trigger: react to how close
  // the rendered window is to the end, not a raw data-fetching effect
  // (CODESTYLE.md §11 targets the latter, not this kind of scroll plumbing).
  useEffect(() => {
    if (lastIndex === undefined) return
    if (lastIndex >= posts.length - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [lastIndex, posts.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isLoading) return <TimelineSkeleton />
  if (isError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        No se pudo cargar el timeline. Inténtalo de nuevo más tarde.
      </p>
    )
  }
  if (posts.length === 0) return <EmptyTimeline />

  return (
    <div role="feed" aria-busy={isFetchingNextPage} aria-label="Timeline">
      <div ref={containerRef} style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
        {items.map((virtualItem) => {
          const post = posts[virtualItem.index]
          if (!post) return null
          return (
            <div
              key={post.id}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              aria-posinset={virtualItem.index + 1}
              aria-setsize={hasNextPage ? -1 : posts.length}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start - scrollMargin}px)`,
              }}
            >
              <PostCard post={post} />
            </div>
          )
        })}
      </div>
      {isFetchingNextPage && (
        <p className="p-4 text-center text-sm text-muted-foreground">Cargando más…</p>
      )}
    </div>
  )
}
