'use client'

import { NotificationItem } from '@/components/notification-item'
import { TimelineSkeleton } from '@/components/timeline-skeleton'
import { useNotifications } from '@/lib/use-notifications'
import { useEffect, useRef, useState } from 'react'

/** Same useInfiniteQuery + IntersectionObserver-sentinel shape as <ProfilePostList> (ROADMAP.md 1.7). */
export function NotificationsList() {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotifications()
  const notifications = data?.pages.flatMap((page) => page.data) ?? []

  const sentinelRef = useRef<HTMLDivElement>(null)

  // Scroll-triggered pagination is DOM plumbing, not a data-fetching effect
  // itself — same carve-out as <ProfilePostList>/<Timeline> (CODESTYLE.md §11).
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasNextPage || isFetchingNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) fetchNextPage()
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Same aria-live announcement as post-feed-list.tsx, and the same reason
  // it's not a data-fetching effect: reacting to already-fetched data for a
  // screen-reader-only side effect (CODESTYLE.md §11).
  const [announcement, setAnnouncement] = useState('')
  const previousCountRef = useRef(notifications.length)
  useEffect(() => {
    const added = notifications.length - previousCountRef.current
    if (added > 0 && previousCountRef.current > 0) {
      setAnnouncement(`Se cargaron ${added} notificaciones más.`)
    }
    previousCountRef.current = notifications.length
  }, [notifications.length])

  if (isLoading) return <TimelineSkeleton />
  if (isError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        No se pudieron cargar las notificaciones. Inténtalo de nuevo más tarde.
      </p>
    )
  }
  if (notifications.length === 0) {
    return (
      <p className="p-10 text-center text-sm text-muted-foreground">
        Todavía no tienes notificaciones.
      </p>
    )
  }

  return (
    <div role="feed" aria-busy={isFetchingNextPage} aria-label="Notificaciones">
      {notifications.map((notification, index) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          posinset={index + 1}
          setsize={hasNextPage ? -1 : notifications.length}
        />
      ))}
      <div ref={sentinelRef} />
      {isFetchingNextPage && (
        <p className="p-4 text-center text-sm text-muted-foreground">Cargando más…</p>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}
