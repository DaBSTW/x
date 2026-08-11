'use client'

import { Button } from '@/components/ui/button'
import { useFollow, useUnfollow } from '@/lib/use-follow'
import { useState } from 'react'
import { toast } from 'sonner'

/**
 * The profile header's Seguir/Siguiendo toggle (ROADMAP.md 1.6).
 *
 * ⚪ `GET /users/:username` has no `viewer.following` field yet — it's
 * public and would need the same optional-auth support `GET /posts/:id`
 * already deferred for the same reason (ROADMAP.md 1.4). So this always
 * starts at "Seguir", even on an account the caller already follows, until
 * that lands — the toggle itself is real from the first click onward.
 */
export function FollowButton({ userId }: { userId: string }) {
  const [isFollowing, setIsFollowing] = useState(false)
  const follow = useFollow()
  const unfollow = useUnfollow()

  const toggle = () => {
    const next = !isFollowing
    setIsFollowing(next)
    const mutation = next ? follow : unfollow
    mutation.mutate(userId, {
      onError: () => {
        setIsFollowing(!next)
        toast.error('No se pudo actualizar el seguimiento.')
      },
    })
  }

  return (
    <Button
      type="button"
      variant={isFollowing ? 'outline' : 'default'}
      onClick={toggle}
      disabled={follow.isPending || unfollow.isPending}
    >
      {isFollowing ? 'Siguiendo' : 'Seguir'}
    </Button>
  )
}
