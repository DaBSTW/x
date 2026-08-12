'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAddListMember, useListMembers, useRemoveListMember } from '@/lib/use-lists'
import Link from 'next/link'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'

type ListMembersProps = {
  listId: string
  /** Add/remove controls only render for the owner — everyone else (a public list is visible to anyone; a private one never reaches this component at all, list-page.tsx bails out earlier) sees a read-only roster. */
  isOwner: boolean
}

/**
 * GET/POST/DELETE /lists/:id/members (ROADMAP.md 2.8) — the API has
 * supported this since the module's first checkpoint; this is the UI
 * catching up. Adding is by exact username, not a search box — the ROADMAP
 * note for this bullet explicitly settles for "a simple input" until real
 * search (2.3) exists.
 */
export function ListMembers({ listId, isOwner }: ListMembersProps) {
  const { data: members, isLoading } = useListMembers(listId)
  const addMember = useAddListMember()
  const removeMember = useRemoveListMember()
  const [username, setUsername] = useState('')

  function onAddSubmit(event: FormEvent) {
    event.preventDefault()
    // A pasted "@bob" is a reasonable thing to type here even though the
    // API wants the bare username — stripped before it ever reaches
    // GET /users/{username}, same courtesy composer.tsx's mention parsing
    // extends to '@' in post text.
    const trimmed = username.trim().replace(/^@/, '')
    if (!trimmed) return
    addMember.mutate(
      { listId, username: trimmed },
      {
        onSuccess: (member) => {
          toast.success(`@${member.username} añadido a la lista.`)
          setUsername('')
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'No se pudo añadir.')
        },
      },
    )
  }

  function onRemoveClick(memberId: string, memberUsername: string) {
    removeMember.mutate(
      { listId, userId: memberId },
      {
        onSuccess: () => toast.success(`@${memberUsername} quitado de la lista.`),
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'No se pudo quitar.')
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border p-4">
      {isOwner && (
        <form onSubmit={onAddSubmit} className="flex gap-2">
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Usuario a añadir (sin @)"
            aria-label="Usuario a añadir"
            maxLength={15}
          />
          <Button type="submit" disabled={addMember.isPending || username.trim() === ''}>
            {addMember.isPending ? 'Añadiendo…' : 'Añadir'}
          </Button>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando miembros…</p>
      ) : !members || members.length === 0 ? (
        <p className="text-sm text-muted-foreground">Esta lista todavía no tiene miembros.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-2">
              <Link
                href={`/${member.username}`}
                className="flex min-w-0 items-center gap-2 hover:underline"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={member.avatarUrl ?? undefined} alt="" />
                  <AvatarFallback>{member.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 truncate text-sm">
                  <span className="font-semibold">{member.displayName}</span>{' '}
                  <span className="text-muted-foreground">@{member.username}</span>
                </span>
              </Link>
              {isOwner && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={removeMember.isPending}
                  onClick={() => onRemoveClick(member.id, member.username)}
                >
                  Quitar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
