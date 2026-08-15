import type { ModerationActionType, ModerationTargetType, ReportCategory } from '@x/contracts'

const relativeTimeFormatter = new Intl.RelativeTimeFormat('es', { numeric: 'auto', style: 'short' })
const fullDateTimeFormatter = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
]

/** "hace 3 h" — same Intl.RelativeTimeFormat approach as apps/web's own lib/format.ts (duplicated on purpose, CODESTYLE.md §7 — one function, not worth a shared package). */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = new Date(iso).getTime() - now.getTime()
  for (const { unit, ms } of UNITS) {
    if (Math.abs(diffMs) >= ms) {
      return relativeTimeFormatter.format(Math.round(diffMs / ms), unit)
    }
  }
  return relativeTimeFormatter.format(Math.round(diffMs / 1000), 'second')
}

/** "11 ago 2026, 14:32" — an audit trail (the history/queue tables) reads better with an anchor a moderator can cross-check against other systems than a relative "hace 3 h" that goes stale the moment the page sits open. */
export function formatFullDateTime(iso: string): string {
  return fullDateTimeFormatter.format(new Date(iso))
}

const ACTION_LABELS: Record<ModerationActionType, string> = {
  label: 'Etiqueta',
  reduce_reach: 'Reducción de alcance',
  hide: 'Ocultación',
  delete: 'Eliminación',
  read_only: 'Modo lectura',
  suspend: 'Suspensión',
  ban: 'Baneo permanente',
}

/** SPECS.md §12.2's graduated-action table, Spanish labels for the UI — same set moderation.service.ts's own applyModerationAction enforces, kept in sync by hand (this file's own top import already ties it to the same ModerationActionType the backend contract exports, so a new action type fails typecheck here, not silently falls back to "unknown"). */
export function formatActionLabel(action: ModerationActionType): string {
  return ACTION_LABELS[action]
}

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  spam: 'Spam',
  harassment: 'Acoso',
  hate_speech: 'Discurso de odio',
  violence: 'Violencia',
  nsfw: 'Contenido sexual explícito',
  misinformation: 'Desinformación',
  self_harm: 'Autolesión',
  coordinated_activity: 'Actividad coordinada',
  other: 'Otro',
}

export function formatCategoryLabel(category: ReportCategory): string {
  return CATEGORY_LABELS[category]
}

const TARGET_TYPE_LABELS: Record<ModerationTargetType, string> = {
  post: 'Post',
  user: 'Cuenta',
}

export function formatTargetTypeLabel(targetType: ModerationTargetType): string {
  return TARGET_TYPE_LABELS[targetType]
}
