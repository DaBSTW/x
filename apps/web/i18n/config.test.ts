import { describe, expect, it } from 'vitest'
import en from '../messages/en.json'
import es from '../messages/es.json'
import { DEFAULT_LOCALE, LOCALE_DIRECTION, SUPPORTED_LOCALES, isSupportedLocale } from './config.js'

/** Every leaf message key, dot-joined ("Settings.title") — recurses into namespace objects the way next-intl's own nesting works. */
function collectKeys(catalog: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null
      ? collectKeys(value as Record<string, unknown>, path)
      : [path]
  })
}

describe('message catalogs', () => {
  it('carry the exact same key set in every locale — a key present in one and missing in another would silently fall back or throw at render time, never caught by TypeScript', () => {
    const esKeys = collectKeys(es).sort()
    const enKeys = collectKeys(en).sort()
    expect(enKeys).toEqual(esKeys)
  })

  it('has no empty message values in either catalog', () => {
    for (const [locale, catalog] of [
      ['es', es],
      ['en', en],
    ] as const) {
      for (const key of collectKeys(catalog)) {
        const value = key.split('.').reduce<unknown>((node, segment) => {
          return (node as Record<string, unknown>)[segment]
        }, catalog)
        expect(value, `${locale}:${key}`).not.toBe('')
      }
    }
  })

  it('DEFAULT_LOCALE is itself one of SUPPORTED_LOCALES', () => {
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE)
  })

  it('every supported locale has a direction entry', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_DIRECTION[locale]).toMatch(/^(ltr|rtl)$/)
    }
  })
})

describe('isSupportedLocale', () => {
  it('accepts every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(locale)).toBe(true)
    }
  })

  it('rejects an unsupported or malformed value', () => {
    expect(isSupportedLocale('fr')).toBe(false)
    expect(isSupportedLocale(undefined)).toBe(false)
    expect(isSupportedLocale('')).toBe(false)
  })
})
