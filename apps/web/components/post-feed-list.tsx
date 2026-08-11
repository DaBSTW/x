'use client'

import { PostCard } from '@/components/post-card'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { Post } from '@x/contracts'
import { useEffect, useRef, useState } from 'react'

type PostFeedListProps = {
  posts: Post[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  ariaLabel: string
}

/**
 * The virtualized, infinite-scrolling post list shared by the home timeline
 * and the bookmarks feed (SPECS.md §7.2, ROADMAP.md 2.8) — extracted so both
 * only own their own data hook plus loading/empty/error copy, which differs
 * per caller.
 */
export function PostFeedList({
  posts,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  ariaLabel,
}: PostFeedListProps) {
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

  return (
    <div role="feed" aria-busy={isFetchingNextPage} aria-label={ariaLabel}>
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
