import { LOCALE_DIRECTION } from '@/i18n/config.js'
import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import Script from 'next/script'
import { Providers } from './providers'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Metadata')
  return { title: t('title'), description: t('description') }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Both read the same request-scoped config i18n/request.ts resolves (from
  // the x-locale cookie) — locale for <html lang>, messages for the client
  // provider below, dir derived from locale for ROADMAP.md 2.10's RTL bullet.
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} dir={LOCALE_DIRECTION[locale]} suppressHydrationWarning>
      <body>
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
