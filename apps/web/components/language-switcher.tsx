'use client'

import { LOCALE_COOKIE_NAME, type Locale, SUPPORTED_LOCALES } from '@/i18n/config.js'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import type { ChangeEvent } from 'react'

// A year — a real, durable preference, not a session-only one.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/**
 * ROADMAP.md 2.10: "next-intl con catálogos ICU; español e inglés al
 * lanzamiento". Writes a plain (non-httpOnly) cookie directly — no Server
 * Action needed just to persist a locale preference, and i18n/request.ts
 * already reads this exact cookie server-side on the next request.
 * `router.refresh()` re-fetches every Server Component's RSC payload
 * against the cookie's new value immediately — without it, this app has no
 * `[locale]` URL segment for a client navigation to even react to (see
 * i18n/config.ts's own docstring on why), so the new language wouldn't show
 * up until some unrelated navigation happened to trigger a re-render.
 */
export function LanguageSwitcher() {
  const locale = useLocale()
  const t = useTranslations('LanguageSwitcher')
  const router = useRouter()

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    const nextLocale = event.target.value as Locale
    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`
    router.refresh()
  }

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{t('label')}</span>
      <select
        value={locale}
        onChange={handleChange}
        className="w-fit rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {SUPPORTED_LOCALES.map((code) => (
          <option key={code} value={code}>
            {t(code)}
          </option>
        ))}
      </select>
    </label>
  )
}
