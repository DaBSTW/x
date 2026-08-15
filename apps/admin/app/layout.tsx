import type { Metadata } from 'next'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'X — Panel de moderación',
  description: 'Cola de revisión, historial de acciones y búsqueda de cuentas.',
}

// No next-intl here (unlike apps/web) — an internal moderator tool, not a
// user-facing surface, so ROADMAP.md 2.10's i18n/RTL bullet doesn't extend
// to it. Spanish only, hardcoded, matching this codebase's own default
// language everywhere else moderator-facing text already lives (email
// copy, ROADMAP.md/SPECS.md themselves).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
