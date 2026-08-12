'use client'

import {
  useNotificationPreferences,
  useUpdateNotificationPreference,
} from '@/lib/use-notification-preferences'
import {
  CONFIGURABLE_NOTIFICATION_KINDS,
  type ConfigurableNotificationKind,
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
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

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  in_app: 'En la app',
  push: 'Push',
}

/**
 * Both channels the API already models (notifications.service.ts's
 * getPreferences arms the full kind×channel matrix from Postgres overrides
 * layered onto @x/utils' shared defaults) — this form used to expose only
 * push (ROADMAP.md 2.9's ⚪ note); in_app was on for everything with no way
 * to turn it off. Nothing changed below the hook: useUpdateNotificationPreference
 * already took a channel per call, so this is purely a rendering change.
 */
export function NotificationPreferencesForm() {
  const { data: preferences, isLoading } = useNotificationPreferences()
  const updatePreference = useUpdateNotificationPreference()

  if (isLoading || !preferences) {
    return <p className="text-sm text-muted-foreground">Cargando preferencias…</p>
  }

  function isEnabled(kind: ConfigurableNotificationKind, channel: NotificationChannel): boolean {
    return preferences?.some((p) => p.kind === kind && p.channel === channel && p.enabled) ?? false
  }

  function onToggle(
    kind: ConfigurableNotificationKind,
    channel: NotificationChannel,
    enabled: boolean,
  ) {
    updatePreference.mutate({ kind, channel, enabled })
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left font-normal text-muted-foreground">Tipo</th>
            {NOTIFICATION_CHANNELS.map((channel) => (
              <th key={channel} className="px-2 font-normal text-muted-foreground">
                {CHANNEL_LABELS[channel]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CONFIGURABLE_NOTIFICATION_KINDS.map((kind) => (
            <tr key={kind}>
              <td className="py-2">{KIND_LABELS[kind]}</td>
              {NOTIFICATION_CHANNELS.map((channel) => (
                <td key={channel} className="px-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${CHANNEL_LABELS[channel]}: ${KIND_LABELS[kind]}`}
                    checked={isEnabled(kind, channel)}
                    onChange={(event) => onToggle(kind, channel, event.target.checked)}
                    className="size-4 accent-primary"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
