'use client'

import { useCurrentUser, useUpdateProfile } from '@/lib/use-current-user'
import { toast } from 'sonner'

/** ROADMAP.md 2.6 "cuentas protegidas": while on, a new follower needs to be approved (see /follow-requests) and only approved followers see the account's posts. */
export function ProtectedAccountToggle() {
  const { data: me, isLoading } = useCurrentUser()
  const updateProfile = useUpdateProfile()

  if (isLoading || !me) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>
  }

  function onChange(isProtected: boolean) {
    updateProfile.mutate(
      { isProtected },
      {
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la cuenta.')
        },
      },
    )
  }

  return (
    <label htmlFor="isProtected" className="flex items-center justify-between gap-4 text-sm">
      <span>
        Proteger mis posts
        <span className="block text-muted-foreground">
          Solo tus seguidores aprobados podrán verlos. Los nuevos seguidores necesitarán tu
          aprobación.
        </span>
      </span>
      <input
        id="isProtected"
        type="checkbox"
        checked={me.isProtected}
        onChange={(event) => onChange(event.target.checked)}
        disabled={updateProfile.isPending}
        className="size-4 accent-primary"
      />
    </label>
  )
}
