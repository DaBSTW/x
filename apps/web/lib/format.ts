const relativeTimeFormatter = new Intl.RelativeTimeFormat('es', { numeric: 'auto', style: 'short' })
const compactNumberFormatter = new Intl.NumberFormat('es', { notation: 'compact' })
const joinDateFormatter = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' })

const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
]

/** "hace 3 h" — SPECS.md §7.6's Intl.RelativeTimeFormat, never a raw timestamp. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = new Date(iso).getTime() - now.getTime()
  for (const { unit, ms } of UNITS) {
    if (Math.abs(diffMs) >= ms) {
      return relativeTimeFormatter.format(Math.round(diffMs / ms), unit)
    }
  }
  return relativeTimeFormatter.format(Math.round(diffMs / 1000), 'second')
}

/** "1,2 mil" — SPECS.md §7.6's Intl.NumberFormat compact notation. */
export function formatCompactNumber(value: number): string {
  return compactNumberFormatter.format(value)
}

/** "agosto de 2026" — the profile header's "Se unió en" (SPECS.md §7.2). */
export function formatJoinDate(iso: string): string {
  return joinDateFormatter.format(new Date(iso))
}
