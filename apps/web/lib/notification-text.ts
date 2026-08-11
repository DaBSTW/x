import type { Notification } from '@x/contracts'

/** The line each <NotificationItem> renders — pure so it's testable without a component (SPECS.md §7.2). */
export function notificationText(notification: Notification): string {
  const name = notification.actor?.displayName ?? 'Alguien'
  switch (notification.kind) {
    case 'like':
      return `${name} le dio me gusta a tu post`
    case 'repost':
      return `${name} reposteó tu post`
    case 'reply':
      return `${name} respondió a tu post`
    case 'quote':
      return `${name} citó tu post`
    case 'follow':
      return `${name} empezó a seguirte`
    case 'mention':
      return `${name} te mencionó en un post`
    case 'follow_request':
      return `${name} quiere seguirte`
    case 'system':
      return 'Notificación del sistema'
  }
}

/**
 * Where tapping the notification goes. The post page's `:username` segment
 * is cosmetic (app/[username]/status/[id]/page.tsx resolves by id alone),
 * so the actor's username is a fine placeholder even for kinds like "like"
 * where the post itself was actually authored by the recipient, not the actor.
 */
export function notificationHref(notification: Notification): string | null {
  if (notification.postId) {
    return `/${notification.actor?.username ?? 'x'}/status/${notification.postId}`
  }
  if (notification.actor) {
    return `/${notification.actor.username}`
  }
  return null
}
