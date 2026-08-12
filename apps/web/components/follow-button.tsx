'use client'

import { Button } from '@/components/ui/button'
import { useFollow, useUnfollow } from '@/lib/use-follow'
import type { ProfileViewerState } from '@x/contracts'
import { useState } from 'react'
import { toast } from 'sonner'

type FollowState = 'not-following' | 'following' | 'requested'

function toFollowState(viewer: ProfileViewerState | null | undefined): FollowState {
  if (!viewer) return 'not-following'
  if (viewer.following) return 'following'
  if (viewer.requested) return 'requested'
  return 'not-following'
}

/**
 * The profile header's Seguir/Siguiendo toggle (ROADMAP.md 1.6). A
 * protected account (ROADMAP.md 2.6) goes to "requested" instead of
 * "following" — clicking again while requested cancels it, the same
 * DELETE /users/{id}/follow a real unfollow uses (unfollow() handles both,
 * see social-graph.service.ts).
 *
 * `initialViewerState` seeds the starting label from `GET
 * /users/:username`'s `viewer` field (ROADMAP.md 1.4/1.6) — `undefined`
 * (the caller hasn't fetched it, or there's nothing to fetch: anonymous,
 * or no `<ProfileHeader>` caller at all) falls back to "Seguir", same as
 * before this existed. `<ProfileHeader>` passes it via `key` so this
 * remounts (and re-seeds `useState`) once the async lookup resolves,
 * instead of a `useEffect` syncing a prop into state (CODESTYLE.md §11).
 */
export function FollowButton({
  userId,
  initialViewerState,
}: {
  userId: string
  initialViewerState?: ProfileViewerState | null
}) {
  const [state, setState] = useState<FollowState>(() => toFollowState(initialViewerState))
  const follow = useFollow()
  const unfollow = useUnfollow()

  function onClick() {
    if (state === 'not-following') {
      follow.mutate(userId, {
        onSuccess: (status) => setState(status),
        onError: () => {
          toast.error('No se pudo seguir a esta cuenta.')
        },
      })
      return
    }

    const previous = state
    setState('not-following')
    unfollow.mutate(userId, {
      onError: () => {
        setState(previous)
        toast.error('No se pudo actualizar el seguimiento.')
      },
    })
  }

  const label =
    state === 'following' ? 'Siguiendo' : state === 'requested' ? 'Solicitud enviada' : 'Seguir'

  return (
    <Button
      type="button"
      variant={state === 'not-following' ? 'default' : 'outline'}
      onClick={onClick}
      disabled={follow.isPending || unfollow.isPending}
    >
      {label}
    </Button>
  )
}
