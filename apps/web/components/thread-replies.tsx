'use client'

import { PostCard } from '@/components/post-card'
import { Button } from '@/components/ui/button'
import { useThreadReplies } from '@/lib/use-thread-replies'
import type { Post } from '@x/contracts'
import { useEffect, useRef, useState } from 'react'

type ThreadRepliesProps = {
  postId: string
  initialReplies: Post[]
  initialCursor: string | null
}

/**
 * <ThreadView>'s reply list with a "cargar más respuestas" button
 * (ROADMAP.md 2.1) — GET /posts/:id/thread already server-rendered
 * `initialReplies`, this only handles paging further than that first page.
 * A button, not the <ProfilePostList>/<Timeline> IntersectionObserver
 * sentinel: replies here are a fixed-size first page handed off by the
 * page's own server component, not an open-ended infinite list.
 */
export function ThreadReplies({ postId, initialReplies, initialCursor }: ThreadRepliesProps) {
  const { replies, hasMore, isLoading, error, loadMore } = useThreadReplies(
    postId,
    initialReplies,
    initialCursor,
  )

  // Same aria-live announcement convention as post-feed-list.tsx /
  // profile-post-list.tsx — primitive deps, not `replies` itself, so this
  // doesn't re-fire on every render just because the array's identity changed.
  const [announcement, setAnnouncement] = useState('')
  const previousCountRef = useRef(replies.length)
  useEffect(() => {
    const added = replies.length - previousCountRef.current
    if (added > 0 && previousCountRef.current > 0) {
      setAnnouncement(`Se cargaron ${added} respuestas más.`)
    }
    previousCountRef.current = replies.length
  }, [replies.length])

  if (replies.length === 0) return null

  return (
    <div
      role="feed"
      aria-busy={isLoading}
      aria-label="Respuestas"
      className="border-t-4 border-border"
    >
      {replies.map((post, index) => (
        <div key={post.id} aria-posinset={index + 1} aria-setsize={hasMore ? -1 : replies.length}>
          <PostCard post={post} />
        </div>
      ))}
      {hasMore && (
        <div className="p-4 text-center">
          <Button type="button" variant="outline" onClick={loadMore} disabled={isLoading}>
            {isLoading ? 'Cargando…' : 'Cargar más respuestas'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="p-4 text-center text-sm text-destructive">
          No se pudieron cargar más respuestas. Inténtalo de nuevo.
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}
