import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/cn'
import { formatRelativeTime } from '@/lib/format'
import type { NotificationDisplayItem } from '@/lib/notification-grouping'
import {
  groupedNotificationHref,
  groupedNotificationText,
  notificationHref,
  notificationText,
} from '@/lib/notification-text'
import Link from 'next/link'

type NotificationItemProps = {
  item: NotificationDisplayItem
  /** This item's position within <NotificationsList>'s role="feed" — WAI-ARIA expects a feed's direct children to carry these, same as <PostCard> already does via post-feed-list.tsx/profile-post-list.tsx. A collapsed group counts as one position, same as the single row it visually replaces. */
  posinset: number
  setsize: number
}

/**
 * One row in <NotificationsList> — unread ones get a tinted background,
 * same visual language as an unread email (ROADMAP.md 1.7, SPECS.md §7.2).
 * `item` is either a single notification or a collapsed group of
 * same-`groupKey` ones within an hour of each other
 * (`lib/notification-grouping.ts`, ROADMAP.md 1.7's own "colapso visual"
 * bullet) — this stays a thin rendering wrapper picking between the two
 * pure-function pairs (`notificationText`/`notificationHref` vs.
 * `groupedNotificationText`/`groupedNotificationHref`), same reasoning this
 * component was already exempt from unit coverage for before grouping existed.
 */
export function NotificationItem({ item, posinset, setsize }: NotificationItemProps) {
  const href =
    item.kind === 'single'
      ? notificationHref(item.notification)
      : groupedNotificationHref(item.group)
  const text =
    item.kind === 'single'
      ? notificationText(item.notification)
      : groupedNotificationText(item.group)
  const isRead = item.kind === 'single' ? item.notification.isRead : item.group.isRead
  const createdAt = item.kind === 'single' ? item.notification.createdAt : item.group.createdAt
  // The newest actor's avatar represents the whole group — no stacked-
  // avatars treatment. ROADMAP.md 1.7 asked for the visual *collapse*
  // itself, not a richer avatar cluster on top of it; a real, separate
  // polish item if that's ever wanted, not hidden inside this one.
  const avatarActor =
    item.kind === 'single' ? item.notification.actor : (item.group.actors.at(0) ?? null)

  const body = (
    <div className={cn('flex gap-3 border-b border-border p-4', !isRead && 'bg-primary/5')}>
      <Avatar>
        <AvatarImage src={avatarActor?.avatarUrl ?? undefined} alt="" />
        <AvatarFallback>
          {(avatarActor?.displayName ?? '?').slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm">{text}</p>
        <time dateTime={createdAt} className="text-xs text-muted-foreground">
          {formatRelativeTime(createdAt)}
        </time>
      </div>
    </div>
  )

  return (
    <article aria-posinset={posinset} aria-setsize={setsize}>
      {href ? <Link href={href}>{body}</Link> : body}
    </article>
  )
}
