'use client'

import {
  useNotificationPreferences,
  useUpdateNotificationPreference,
} from '@/lib/use-notification-preferences'
import {
  CONFIGURABLE_NOTIFICATION_KINDS,
  type ConfigurableNotificationKind,
} from '@x/utils/notifications'

const KIND_LABELS: Record<ConfigurableNotificationKind, string> = {
  like: 'Me gusta',
  repost: 'Republicaciones',
  reply: 'Respuestas',
  quote: 'Citas',
  follow: 'Nuevos seguidores',
  mention: 'Menciones',
  follow_request: 'Solicitudes de seguimiento',
}

/**
 * Push only — in_app has no UI toggle yet (ROADMAP.md 2.9's ⚪ note): it's
 * on for everything today, and turning it off is a bigger behavior change
 * than this checkpoint's scope. The API already models both channels
 * (notifications.repository.ts), so adding an in_app column here later is
 * additive, not a redesign.
 */
export function NotificationPreferencesForm() {
  const { data: preferences, isLoading } = useNotificationPreferences()
  const updatePreference = useUpdateNotificationPreference()

  if (isLoading || !preferences) {
    return <p className="text-sm text-muted-foreground">Cargando preferencias…</p>
  }

  function isPushEnabled(kind: ConfigurableNotificationKind): boolean {
    return preferences?.some((p) => p.kind === kind && p.channel === 'push' && p.enabled) ?? false
  }

  function onToggle(kind: ConfigurableNotificationKind, enabled: boolean) {
    updatePreference.mutate({ kind, channel: 'push', enabled })
  }

  return (
    <ul className="flex flex-col gap-2">
      {CONFIGURABLE_NOTIFICATION_KINDS.map((kind) => (
        <li key={kind} className="flex items-center justify-between gap-4">
          <label htmlFor={`push-${kind}`} className="text-sm">
            {KIND_LABELS[kind]}
          </label>
          <input
            id={`push-${kind}`}
            type="checkbox"
            checked={isPushEnabled(kind)}
            onChange={(event) => onToggle(kind, event.target.checked)}
            className="size-4 accent-primary"
          />
        </li>
      ))}
    </ul>
  )
}
