'use client'

import { ApplyActionForm } from '@/components/apply-action-form'
import { formatCategoryLabel, formatRelativeTime, formatTargetTypeLabel } from '@/lib/format'
import { useReportsQueue } from '@/lib/use-moderation-queue'
import { useState } from 'react'

/** SPECS.md §12.1's reactive-layer queue: pending reports, most urgent first, each expandable into ApplyActionForm to resolve it. */
export function ReviewQueueList() {
  const { data: reports, isLoading, error } = useReportsQueue('pending')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (error) {
    // requireModerator's own 403-not-404 posture (moderation.routes.ts) —
    // a logged-in, non-moderator caller lands here, not on a broken page.
    return (
      <p className="text-sm text-destructive">
        No se pudo cargar la cola: {error instanceof Error ? error.message : 'error desconocido'}.
        {' Puede que tu cuenta no tenga acceso de moderador.'}
      </p>
    )
  }

  if (isLoading || !reports) {
    return <p className="text-sm text-muted-foreground">Cargando cola…</p>
  }

  if (reports.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay reportes pendientes.</p>
  }

  return (
    <ul aria-label="Cola de revisión" className="flex flex-col gap-3">
      {reports.map((report) => (
        <li key={report.id} className="flex flex-col gap-2 rounded-md border border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="font-medium">
                {formatTargetTypeLabel(report.targetType)} #{report.targetId} ·{' '}
                {formatCategoryLabel(report.category)}
              </span>
              <span className="text-sm text-muted-foreground">
                Prioridad {report.priority} · {formatRelativeTime(report.createdAt)} ·{' '}
                {report.reporterId
                  ? `reportado por #${report.reporterId}`
                  : 'reportado automáticamente'}
              </span>
              {report.reason && <span className="text-sm">{report.reason}</span>}
            </div>
            <button
              type="button"
              className="text-sm text-primary underline"
              onClick={() => setExpandedId(expandedId === report.id ? null : report.id)}
            >
              {expandedId === report.id ? 'Cancelar' : 'Actuar'}
            </button>
          </div>
          {expandedId === report.id && (
            <ApplyActionForm
              targetType={report.targetType}
              targetId={report.targetId}
              reportId={report.id}
              onApplied={() => setExpandedId(null)}
            />
          )}
        </li>
      ))}
    </ul>
  )
}
