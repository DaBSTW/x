import type { Notification } from '@x/contracts'
import type { NotificationGroup } from './notification-grouping'

/**
 * The line each <NotificationItem> renders — pure so it's testable without
 * a component (SPECS.md §7.2). Only ever reads `kind`/`actor`, narrowed to
 * just those (not the full `Notification`) so `groupedNotificationText`
 * below can reuse it for a group that collapsed down to one actor, without
 * synthesizing a fake `id`/`postId`/`createdAt` just to satisfy the type.
 */
export function notificationText(notification: Pick<Notification, 'kind' | 'actor'>): string {
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

/**
 * "Ana y Bea", or "Ana y 12 más" — ROADMAP.md 1.7's own example wording for
 * the group-collapse bullet. Two actors get spelled out in full (matching
 * how a single notification already names its one actor); three or more
 * collapse to the newest one plus a count, the same threshold most feeds
 * use for exactly this reason — spelling out ten names stops being a
 * summary. Only ever called with 2+ actors — groupedNotificationText below
 * handles 0/1 itself by delegating to notificationText instead, where a
 * plural "Ana y Bea" phrasing wouldn't apply.
 */
function actorListText(actors: NotificationGroup['actors']): string {
  const first = actors.at(0)?.displayName ?? 'Alguien'
  const second = actors.at(1)?.displayName
  if (actors.length === 2 && second) return `${first} y ${second}`
  return `${first} y ${actors.length - 1} más`
}

/**
 * The plural counterpart to `notificationText` for a collapsed run of
 * same-`groupKey` notifications (`notification-grouping.ts`). Every kind is
 * handled, not just the three the backend ever actually groups
 * (like/repost/follow, ROADMAP.md 1.7) — `NotificationGroup`'s type doesn't
 * enforce that restriction, and an exhaustive switch here is what makes
 * TypeScript catch a missing case if `notificationKindSchema` ever grows one,
 * the same reasoning `toFollowState`-style helpers elsewhere avoid a catch-all
 * default for.
 */
export function groupedNotificationText(group: NotificationGroup): string {
  // A "group" that de-duped down to one actor (the same person notifying
  // twice inside the window — a repeat like, say) reads exactly like a
  // single notification, not a grammatically-plural one ("Ana le dieron
  // me gusta" disagrees in number) — delegating to notificationText avoids
  // a second, singular copy of every case below that could drift from this one.
  if (group.actors.length <= 1) {
    return notificationText({ kind: group.kind, actor: group.actors.at(0) ?? null })
  }
  const names = actorListText(group.actors)
  switch (group.kind) {
    case 'like':
      return `${names} le dieron me gusta a tu post`
    case 'repost':
      return `${names} repostearon tu post`
    case 'reply':
      return `${names} respondieron a tu post`
    case 'quote':
      return `${names} citaron tu post`
    case 'follow':
      return `${names} empezaron a seguirte`
    case 'mention':
      return `${names} te mencionaron en un post`
    case 'follow_request':
      return `${names} quieren seguirte`
    case 'system':
      return 'Notificación del sistema'
  }
}

/** Same reasoning as `notificationHref`, generalized to the group's newest actor — there's no per-account list view to send a multi-actor group to instead. */
export function groupedNotificationHref(group: NotificationGroup): string | null {
  const newestActor = group.actors.at(0)
  if (group.postId) {
    return `/${newestActor?.username ?? 'x'}/status/${group.postId}`
  }
  if (newestActor) {
    return `/${newestActor.username}`
  }
  return null
}
