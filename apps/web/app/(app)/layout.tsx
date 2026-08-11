'use client'

import { ThemeToggle } from '@/components/theme-toggle'
import { useCurrentUser } from '@/lib/use-current-user'
import { useSession } from '@/lib/use-session'
import { useUnreadCount } from '@/lib/use-unread-count'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { isLoading, isAuthenticated } = useSession()
  const { data: me } = useCurrentUser()
  const { data: unreadCount } = useUnreadCount()

  // Route protection is a navigation side-effect, not a data fetch — the
  // data fetch itself (the session query) already went through TanStack
  // Query in useSession, per CODESTYLE.md §11.
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
        <span className="text-lg font-semibold">X</span>
        <nav className="flex flex-col gap-2 text-sm">
          <Link href="/home">Inicio</Link>
          <Link href="/notifications" className="flex items-center gap-2">
            Notificaciones
            {Boolean(unreadCount) && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs leading-none text-primary-foreground">
                {unreadCount && unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Link>
          <Link href="/bookmarks">Guardados</Link>
          <Link href="/lists">Listas</Link>
          <Link href="/messages">Mensajes</Link>
          {me && <Link href={`/${me.username}`}>Perfil</Link>}
          <Link href="/settings">Configuración</Link>
        </nav>
        <div className="mt-auto">
          <ThemeToggle />
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
