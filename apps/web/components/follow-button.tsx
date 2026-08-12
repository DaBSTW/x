'use client'

import { Button } from '@/components/ui/button'
import { useFollow, useUnfollow } from '@/lib/use-follow'
import { useState } from 'react'
import { toast } from 'sonner'

type FollowState = 'not-following' | 'following' | 'requested'

/**
 * The profile header's Seguir/Siguiendo toggle (ROADMAP.md 1.6). A
 * protected account (ROADMAP.md 2.6) goes to "requested" instead of
 * "following" — clicking again while requested cancels it, the same
 * DELETE /users/{id}/follow a real unfollow uses (unfollow() handles both,
 * see social-graph.service.ts).
 *
 * ⚪ `GET /users/:username` has no `viewer.following`/`viewer.requested`
 * field yet — it's public and would need the same optional-auth support
 * `GET /posts/:id` already deferred for the same reason (ROADMAP.md 1.4).
 * So this always starts at "Seguir", even on an account already followed
 * or requested, until that lands — the toggle itself is real from the
 * first click onward.
 */
export function FollowButton({ userId }: { userId: string }) {
  const [state, setState] = useState<FollowState>('not-following')
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
