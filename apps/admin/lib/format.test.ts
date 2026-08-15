import { describe, expect, it } from 'vitest'
import {
  formatActionLabel,
  formatCategoryLabel,
  formatFullDateTime,
  formatRelativeTime,
  formatTargetTypeLabel,
} from './format.js'

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-15T12:00:00.000Z')

  it('renders minutes for a report from a few minutes ago', () => {
    const iso = new Date(now.getTime() - 5 * 60_000).toISOString()
    expect(formatRelativeTime(iso, now)).toBe('hace 5 min')
  })

  it('renders hours once past the minute range', () => {
    const iso = new Date(now.getTime() - 3 * 60 * 60_000).toISOString()
    expect(formatRelativeTime(iso, now)).toBe('hace 3 h')
  })

  it('falls back to seconds for a just-now action', () => {
    const iso = new Date(now.getTime() - 10_000).toISOString()
    expect(formatRelativeTime(iso, now)).toBe('hace 10 s')
  })
})

describe('formatFullDateTime', () => {
  it('renders "date, time" in Spanish', () => {
    // Assumes a UTC runtime (this repo's CI and every *.test.ts environment
    // here run UTC) — formatFullDateTime deliberately has no timeZone
    // option, so it renders in whatever zone the browser itself is in.
    expect(formatFullDateTime('2026-08-11T14:32:00.000Z')).toBe('11 ago 2026, 14:32')
  })
})

describe('formatActionLabel', () => {
  it('labels every SPECS.md §12.2 graduated action in Spanish', () => {
    expect(formatActionLabel('label')).toBe('Etiqueta')
    expect(formatActionLabel('reduce_reach')).toBe('Reducción de alcance')
    expect(formatActionLabel('hide')).toBe('Ocultación')
    expect(formatActionLabel('delete')).toBe('Eliminación')
    expect(formatActionLabel('read_only')).toBe('Modo lectura')
    expect(formatActionLabel('suspend')).toBe('Suspensión')
    expect(formatActionLabel('ban')).toBe('Baneo permanente')
  })
})

describe('formatCategoryLabel', () => {
  it('labels the coordinated_activity category added by ROADMAP.md 3.3f', () => {
    expect(formatCategoryLabel('coordinated_activity')).toBe('Actividad coordinada')
  })

  it('labels every other report category', () => {
    expect(formatCategoryLabel('spam')).toBe('Spam')
    expect(formatCategoryLabel('harassment')).toBe('Acoso')
    expect(formatCategoryLabel('hate_speech')).toBe('Discurso de odio')
    expect(formatCategoryLabel('violence')).toBe('Violencia')
    expect(formatCategoryLabel('nsfw')).toBe('Contenido sexual explícito')
    expect(formatCategoryLabel('misinformation')).toBe('Desinformación')
    expect(formatCategoryLabel('self_harm')).toBe('Autolesión')
    expect(formatCategoryLabel('other')).toBe('Otro')
  })
})

describe('formatTargetTypeLabel', () => {
  it('labels both moderation target types', () => {
    expect(formatTargetTypeLabel('post')).toBe('Post')
    expect(formatTargetTypeLabel('user')).toBe('Cuenta')
  })
})
