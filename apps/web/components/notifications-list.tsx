'use client'

import { NotificationItem } from '@/components/notification-item'
import { TimelineSkeleton } from '@/components/timeline-skeleton'
import { groupNotifications } from '@/lib/notification-grouping'
import { useNotifications } from '@/lib/use-notifications'
import { useEffect, useRef, useState } from 'react'

/** Same useInfiniteQuery + IntersectionObserver-sentinel shape as <ProfilePostList> (ROADMAP.md 1.7). */
export function NotificationsList() {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotifications()
  const notifications = data?.pages.flatMap((page) => page.data) ?? []
  // ROADMAP.md 1.7's "colapso visual" bullet: consecutive same-groupKey
  // notifications within an hour render as one row ("Ana y 12 más te
  // dieron me gusta"), not N. Pagination/read-state below still reasons in
  // terms of the raw, ungrouped `notifications` — grouping is a display
  // concern only, layered on top right before rendering.
  const displayItems = groupNotifications(notifications)

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
      {displayItems.map((item, index) => (
        <NotificationItem
          // A group's own id would repeat across re-renders that reorder
          // its members no differently than before, but its newest
          // member's id is exactly as stable as a single notification's
          // own id already was — same Snowflake id space either way.
          key={item.kind === 'single' ? item.notification.id : item.group.notifications[0]?.id}
          item={item}
          posinset={index + 1}
          setsize={hasNextPage ? -1 : displayItems.length}
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
