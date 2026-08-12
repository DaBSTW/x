import type { NotificationKind } from '@x/utils'

export type PushText = { title: string; body: string }

/**
 * Mirrors apps/web/lib/notification-text.ts's phrasing — duplicated rather
 * than imported (apps→apps imports aren't allowed, eslint.config.js's
 * boundaries/element-types rule), and the inputs differ anyway: this only
 * ever has an actor's username fresh out of Postgres, not a hydrated
 * Notification with a display name.
 */
export function buildPushText(kind: NotificationKind, actorUsername: string | null): PushText {
  const name = actorUsername ? `@${actorUsername}` : 'Alguien'
  const title = 'X'
  switch (kind) {
    case 'like':
      return { title, body: `${name} le dio me gusta a tu post` }
    case 'repost':
      return { title, body: `${name} reposteó tu post` }
    case 'reply':
      return { title, body: `${name} respondió a tu post` }
    case 'quote':
      return { title, body: `${name} citó tu post` }
    case 'follow':
      return { title, body: `${name} empezó a seguirte` }
    case 'mention':
      return { title, body: `${name} te mencionó en un post` }
    case 'follow_request':
      return { title, body: `${name} quiere seguirte` }
    case 'system':
      return { title, body: 'Notificación del sistema' }
  }
}
