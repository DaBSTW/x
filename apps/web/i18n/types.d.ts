import type messages from '../messages/es.json'
import type { Locale } from './config.js'

// Type-safe `useTranslations`/`getTranslations` keys and ICU argument
// shapes, checked against the Spanish catalog — the source of truth new
// keys get added to first (both catalogs are asserted to carry the exact
// same key set in i18n/config.test.ts, so checking against either alone is
// equivalent). `Locale` narrows `useLocale()`/`getLocale()`'s own return
// type to this app's actual two locales, instead of a bare `string`.
declare module 'next-intl' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- TS module augmentation (declaration merging) only works with `interface`, not `type`; this is next-intl's own documented pattern.
  interface AppConfig {
    Locale: Locale
    Messages: typeof messages
  }
}
