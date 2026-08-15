'use client'

import { formatActionLabel, formatFullDateTime, formatTargetTypeLabel } from '@/lib/format'
import { useActionsHistory } from '@/lib/use-moderation-history'
import type { ModerationAction } from '@x/contracts'

function actorLabel(action: ModerationAction): string {
  if (action.actorType === 'system') return 'sistema (clasificador automático)'
  return `moderador #${action.actorId}`
}

/** GET /moderation/actions — the global, immutable audit trail (SPECS.md §12.2). */
export function ActionHistoryList() {
  const { data: actions, isLoading, error } = useActionsHistory()

  if (error) {
    return (
      <p className="text-sm text-destructive">
        No se pudo cargar el historial:{' '}
        {error instanceof Error ? error.message : 'error desconocido'}.
        {' Puede que tu cuenta no tenga acceso de moderador.'}
      </p>
    )
  }

  if (isLoading || !actions) {
    return <p className="text-sm text-muted-foreground">Cargando historial…</p>
  }

  if (actions.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay acciones registradas.</p>
  }

  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">Historial de acciones de moderación</caption>
      <thead>
        <tr className="border-b border-border text-muted-foreground">
          <th className="py-2 pr-4 font-medium">Acción</th>
          <th className="py-2 pr-4 font-medium">Objetivo</th>
          <th className="py-2 pr-4 font-medium">Política</th>
          <th className="py-2 pr-4 font-medium">Motivo</th>
          <th className="py-2 pr-4 font-medium">Actor</th>
          <th className="py-2 font-medium">Fecha</th>
        </tr>
      </thead>
      <tbody>
        {actions.map((action) => (
          <tr key={action.id} className="border-b border-border last:border-0">
            <td className="py-2 pr-4">{formatActionLabel(action.action)}</td>
            <td className="py-2 pr-4">
              {formatTargetTypeLabel(action.targetType)} #{action.targetId}
            </td>
            <td className="py-2 pr-4">{action.policy}</td>
            <td className="py-2 pr-4">{action.reason}</td>
            <td className="py-2 pr-4">{actorLabel(action)}</td>
            <td className="py-2">{formatFullDateTime(action.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
