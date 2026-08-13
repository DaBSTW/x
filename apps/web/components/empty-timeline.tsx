'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useFollow } from '@/lib/use-follow'
import { useSuggestions } from '@/lib/use-suggestions'

/** ROADMAP.md 1.8: "estados vacíos con acción sugerida" — backed by the real GET /users/suggestions endpoint, not a dead-end message. */
export function EmptyTimeline() {
  const { data: suggestions, isLoading } = useSuggestions()
  const follow = useFollow()

  return (
    <div className="flex flex-col items-center gap-6 p-10 text-center">
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold">Tu timeline está vacío</p>
        <p className="text-sm text-muted-foreground">Sigue a alguien para ver sus posts aquí.</p>
      </div>
      {!isLoading && suggestions && suggestions.length > 0 && (
        <ul className="flex w-full max-w-sm flex-col gap-3 text-start">
          {suggestions.map((user) => {
            const isFollowingThisUser = follow.isPending && follow.variables === user.id
            return (
              <li key={user.id} className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src={user.avatarUrl ?? undefined} alt="" />
                  <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{user.displayName}</p>
                  <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isFollowingThisUser}
                  onClick={() => follow.mutate(user.id)}
                >
                  {isFollowingThisUser ? 'Siguiendo…' : 'Seguir'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
