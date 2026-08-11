import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/cn'
import { formatRelativeTime } from '@/lib/format'
import { notificationHref, notificationText } from '@/lib/notification-text'
import type { Notification } from '@x/contracts'
import Link from 'next/link'

type NotificationItemProps = {
  notification: Notification
}

/** One row in <NotificationsList> — unread ones get a tinted background, same visual language as an unread email (ROADMAP.md 1.7, SPECS.md §7.2). */
export function NotificationItem({ notification }: NotificationItemProps) {
  const href = notificationHref(notification)

  const body = (
    <div
      className={cn(
        'flex gap-3 border-b border-border p-4',
        !notification.isRead && 'bg-primary/5',
      )}
    >
      <Avatar>
        <AvatarImage src={notification.actor?.avatarUrl ?? undefined} alt="" />
        <AvatarFallback>
          {(notification.actor?.displayName ?? '?').slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm">{notificationText(notification)}</p>
        <time dateTime={notification.createdAt} className="text-xs text-muted-foreground">
          {formatRelativeTime(notification.createdAt)}
        </time>
      </div>
    </div>
  )

  return href ? <Link href={href}>{body}</Link> : body
}
