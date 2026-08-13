// ROADMAP.md 2.10: "next-intl con catálogos ICU; español e inglés al
// lanzamiento". No `[locale]` URL segment (next-intl's "without i18n
// routing" setup) — every existing route (app/(app)/*, app/[username], …)
// already ships without one, and forcing every link/bookmark/e2e test in
// the app onto a `/es/...`-prefixed URL is a much bigger, riskier change
// than this bullet actually asks for. Locale lives in a cookie instead,
// read server-side by i18n/request.ts.
export const SUPPORTED_LOCALES = ['es', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

// SPECS.md's own UI copy (and this repo's default `<html lang>` before this
// checkpoint) is Spanish-first — the default stays Spanish for a visitor
// with no cookie yet, not the more common "en" convention.
export const DEFAULT_LOCALE: Locale = 'es'

export const LOCALE_COOKIE_NAME = 'x-locale'

export function isSupportedLocale(value: string | undefined): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale)
}

// ROADMAP.md 2.10's other bullet ("soporte RTL con propiedades lógicas de
// CSS") — neither launch locale is actually RTL, so this table exists to
// make the *mechanism* real and switchable, not because es/en need it: a
// future ar/he entry here is the only change adding a real RTL locale would
// need at this layer, everything downstream (the `dir` attribute, every
// component already using logical properties) already reacts to it.
export const LOCALE_DIRECTION: Record<Locale, 'ltr' | 'rtl'> = {
  es: 'ltr',
  en: 'ltr',
}
