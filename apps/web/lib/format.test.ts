import { describe, expect, it } from 'vitest'
import { formatCompactNumber, formatJoinDate, formatRelativeTime } from './format'

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-11T12:00:00.000Z')

  it('renders minutes for a post from a few minutes ago', () => {
    const iso = new Date(now.getTime() - 5 * 60_000).toISOString()
    expect(formatRelativeTime(iso, now)).toBe('hace 5 min')
  })

  it('renders hours once past the minute range', () => {
    const iso = new Date(now.getTime() - 3 * 60 * 60_000).toISOString()
    expect(formatRelativeTime(iso, now)).toBe('hace 3 h')
  })

  it('renders days once past the hour range', () => {
    const iso = new Date(now.getTime() - 3 * 24 * 60 * 60_000).toISOString()
    expect(formatRelativeTime(iso, now)).toBe('hace 3 d')
  })

  it('uses natural Spanish for "the day before yesterday" (numeric: auto)', () => {
    const iso = new Date(now.getTime() - 2 * 24 * 60 * 60_000).toISOString()
    expect(formatRelativeTime(iso, now)).toBe('anteayer')
  })

  it('falls back to seconds for a just-now post', () => {
    const iso = new Date(now.getTime() - 10_000).toISOString()
    expect(formatRelativeTime(iso, now)).toBe('hace 10 s')
  })
})

describe('formatCompactNumber', () => {
  it('leaves small numbers as-is', () => {
    expect(formatCompactNumber(42)).toBe('42')
  })

  it('compacts thousands', () => {
    // ICU joins the number and suffix with a no-break space (U+00A0), not a
    // regular one — visually identical, byte-different.
    expect(formatCompactNumber(1200)).toBe('1,2 mil')
  })

  it('compacts millions', () => {
    expect(formatCompactNumber(3_400_000)).toBe('3,4 M')
  })
})

describe('formatJoinDate', () => {
  it('renders the month and year in Spanish', () => {
    // Mid-month UTC so no reasonable local timezone shifts it into a
    // different month.
    expect(formatJoinDate('2026-08-15T12:00:00.000Z')).toBe('agosto de 2026')
  })
})
