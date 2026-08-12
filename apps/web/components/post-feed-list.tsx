'use client'

import { PostCard } from '@/components/post-card'
import { usePostFeedKeyboardNav } from '@/lib/use-post-feed-keyboard-nav'
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

  usePostFeedKeyboardNav(containerRef, virtualizer, posts.length)

  // SPECS.md §7.5 / ROADMAP.md 2.10: announces each page as it loads — the
  // same "DOM plumbing reacting to already-fetched data" category as the
  // effect above, not a fetch of its own. A screen reader user scrolling
  // this list otherwise gets no signal that more content just appeared.
  // Growth at the *front* (first post's id changed) is use-create-post.ts
  // prepending the caller's own new post, not a pagination page landing at
  // the back — worth a different, more specific announcement than "N more
  // posts loaded" for something the screen reader user just typed themselves.
  const [announcement, setAnnouncement] = useState('')
  const postCount = posts.length
  const firstPostId = posts[0]?.id
  const previousCountRef = useRef(postCount)
  const previousFirstIdRef = useRef(firstPostId)
  useEffect(() => {
    const added = postCount - previousCountRef.current
    if (added > 0 && previousCountRef.current > 0) {
      const isOwnPostPrepended = firstPostId !== previousFirstIdRef.current
      setAnnouncement(
        isOwnPostPrepended ? 'Se publicó tu post.' : `Se cargaron ${added} posts más.`,
      )
    }
    previousCountRef.current = postCount
    previousFirstIdRef.current = firstPostId
    // Primitives only (postCount, firstPostId), not `posts` itself — the
    // array gets a new identity on nearly every render (posts is a fresh
    // .flatMap() each time), which would fire this far more often than
    // "the feed actually grew."
  }, [postCount, firstPostId])

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
              tabIndex={-1}
              aria-posinset={virtualItem.index + 1}
              aria-setsize={hasNextPage ? -1 : posts.length}
              // Plain focus:, not focus-visible: — this div is excluded
              // from the normal Tab order (tabIndex={-1}), so the only way
              // it ever receives DOM focus is use-post-feed-keyboard-nav.ts's
              // deliberate .focus() call, and that ring should always show
              // then rather than depend on the browser's focus-visible
              // heuristic for a programmatic call correctly guessing intent.
              className="focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
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
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}
