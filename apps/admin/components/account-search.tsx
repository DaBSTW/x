'use client'

import { ApplyActionForm } from '@/components/apply-action-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatActionLabel, formatFullDateTime } from '@/lib/format'
import { useTrustScore, useUserByUsername } from '@/lib/use-account-search'
import { useTargetActions } from '@/lib/use-moderation-history'
import { useState } from 'react'

/** ROADMAP.md 3.3g's "búsqueda de cuentas": resolve a handle to an id (GET /users/:username, the same public lookup apps/web uses), then surface everything a moderator needs about that one account — trust score (3.3e) and its own action history — plus a direct way to act on it. */
export function AccountSearch() {
  const [query, setQuery] = useState('')
  const [username, setUsername] = useState<string | null>(null)

  const {
    data: profile,
    isLoading: profileLoading,
    error: profileError,
  } = useUserByUsername(username)
  const { data: trustScore } = useTrustScore(profile?.id ?? null)
  const { data: history } = useTargetActions('user', profile?.id ?? null)

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setUsername(query.trim().replace(/^@/, ''))
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          placeholder="usuario"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Nombre de usuario"
        />
        <Button type="submit" disabled={query.trim().length === 0}>
          Buscar
        </Button>
      </form>

      {profileLoading && <p className="text-sm text-muted-foreground">Buscando…</p>}
      {profileError && (
        <p className="text-sm text-destructive">
          No se encontró ninguna cuenta con ese nombre de usuario.
        </p>
      )}

      {profile && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 rounded-md border border-border p-4">
            <span className="font-medium">
              {profile.displayName} · @{profile.username}
            </span>
            <span className="text-sm text-muted-foreground">
              {profile.counters.followers} seguidores · {profile.counters.following} seguidos ·{' '}
              {profile.counters.posts} posts
            </span>
            {trustScore && (
              <span className="text-sm">
                Score de confianza: <strong>{trustScore.score.toFixed(2)}</strong>
              </span>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">Historial de esta cuenta</h2>
            {!history || history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin acciones previas.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.map((action) => (
                  <li key={action.id} className="text-sm">
                    {formatActionLabel(action.action)} — {action.reason} (
                    {formatFullDateTime(action.createdAt)})
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">Actuar sobre esta cuenta</h2>
            <ApplyActionForm targetType="user" targetId={profile.id} />
          </div>
        </div>
      )}
    </div>
  )
}
