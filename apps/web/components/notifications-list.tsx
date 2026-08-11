'use client'

import { NotificationItem } from '@/components/notification-item'
import { TimelineSkeleton } from '@/components/timeline-skeleton'
import { useNotifications } from '@/lib/use-notifications'
import { useEffect, useRef } from 'react'

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
      {notifications.map((notification) => (
        <NotificationItem key={notification.id} notification={notification} />
      ))}
      <div ref={sentinelRef} />
      {isFetchingNextPage && (
        <p className="p-4 text-center text-sm text-muted-foreground">Cargando más…</p>
      )}
    </div>
  )
}
