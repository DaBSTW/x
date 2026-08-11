'use client'

import { useCurrentUser } from '@/lib/use-current-user'
import { useUserLists } from '@/lib/use-lists'
import Link from 'next/link'

export function MyLists() {
  const { data: me } = useCurrentUser()
  const { data: lists, isLoading } = useUserLists(me?.username)

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>
  }
  if (!lists || lists.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no has creado ninguna lista.</p>
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {lists.map((list) => (
        <li key={list.id}>
          <Link href={`/lists/${list.id}`} className="flex flex-col gap-1 p-4 hover:bg-muted">
            <span className="flex items-center gap-2 font-semibold">
              {list.name}
              {list.isPrivate && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                  Privada
                </span>
              )}
            </span>
            {list.description && (
              <span className="text-sm text-muted-foreground">{list.description}</span>
            )}
            <span className="text-xs text-muted-foreground">
              {list.memberCount} {list.memberCount === 1 ? 'miembro' : 'miembros'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
