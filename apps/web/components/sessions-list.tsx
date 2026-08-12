'use client'

import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/format'
import { useRevokeSession, useSessions } from '@/lib/use-sessions'
import { toast } from 'sonner'

export function SessionsList() {
  const { data: sessions, isLoading } = useSessions()
  const revokeSession = useRevokeSession()

  if (isLoading || !sessions) {
    return <p className="text-sm text-muted-foreground">Cargando sesiones…</p>
  }

  function onRevoke(id: string) {
    revokeSession.mutate(id, {
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'No se pudo cerrar la sesión.')
      },
    })
  }

  return (
    <ul aria-label="Sesiones activas" className="flex flex-col gap-3">
      {sessions.map((session) => (
        <li key={session.id} className="flex items-center justify-between gap-4 text-sm">
          <div className="flex flex-col">
            <span>{session.userAgent ?? 'Dispositivo desconocido'}</span>
            <span className="text-muted-foreground">
              {session.ipAddress ?? 'IP desconocida'} · {formatRelativeTime(session.createdAt)}
            </span>
          </div>
          {session.isCurrent ? (
            <span className="text-xs text-muted-foreground">Esta sesión</span>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onRevoke(session.id)}
              disabled={revokeSession.isPending}
            >
              Cerrar sesión
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
