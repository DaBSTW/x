'use client'

import { Button } from '@/components/ui/button'
import { useLogout } from '@/lib/use-auth-mutations'
import { useSession } from '@/lib/use-session'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

const NAV_LINKS = [
  { href: '/queue', label: 'Cola de revisión' },
  { href: '/history', label: 'Historial de acciones' },
  { href: '/accounts', label: 'Búsqueda de cuentas' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { isLoading, isAuthenticated } = useSession()
  const logout = useLogout()

  // Route protection is a navigation side-effect, not a data fetch — same
  // as apps/web's own (app)/layout.tsx. This only checks "logged in", not
  // "moderator" — use-session.ts's own comment explains why that second
  // check can't happen here.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isLoading, isAuthenticated, router])

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="flex min-h-svh">
      <aside className="flex w-56 flex-col gap-4 border-r border-border p-4">
        <span className="text-lg font-semibold">X · Moderación</span>
        <nav className="flex flex-col gap-2 text-sm">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname === link.href ? 'font-semibold text-primary' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-auto"
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSuccess: () => router.push('/login') })}
        >
          Cerrar sesión
        </Button>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
