'use client'

import { ListMembers } from '@/components/list-members'
import { PostFeedList } from '@/components/post-feed-list'
import { TimelineSkeleton } from '@/components/timeline-skeleton'
import { useCurrentUser } from '@/lib/use-current-user'
import { useListTimeline } from '@/lib/use-list-timeline'
import { useDeleteList, useList } from '@/lib/use-lists'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from './ui/button'

type ListPageProps = {
  listId: string
}

/**
 * Client-fetched rather than SSR'd like the profile/thread pages
 * (ROADMAP.md 2.8) — a private list's visibility depends on who's asking,
 * and server-api-client.ts is deliberately always-anonymous, so an SSR
 * fetch here would 404 a private list even for its own owner. The browser's
 * authenticated apiClient doesn't have that problem.
 */
export function ListPage({ listId }: ListPageProps) {
  const router = useRouter()
  const { data: me } = useCurrentUser()
  const { data: list, isLoading, isError } = useList(listId)
  const timeline = useListTimeline(listId)
  const deleteList = useDeleteList()
  const posts = timeline.data?.pages.flatMap((page) => page.data) ?? []
  const [showMembers, setShowMembers] = useState(false)

  if (isLoading) return <TimelineSkeleton />
  if (isError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        No se pudo cargar la lista. Inténtalo de nuevo más tarde.
      </p>
    )
  }
  if (!list) {
    return <p className="p-6 text-sm text-muted-foreground">Esta lista no existe.</p>
  }

  const isOwner = me?.id === list.ownerId

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-border p-4">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            {list.name}
            {list.isPrivate && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                Privada
              </span>
            )}
          </h1>
          {list.description && <p className="text-sm text-muted-foreground">{list.description}</p>}
          <button
            type="button"
            className="w-fit text-xs text-muted-foreground hover:underline"
            aria-expanded={showMembers}
            onClick={() => setShowMembers((current) => !current)}
          >
            {list.memberCount} {list.memberCount === 1 ? 'miembro' : 'miembros'}
          </button>
        </div>
        {isOwner && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={deleteList.isPending}
            onClick={() => {
              deleteList.mutate(listId, {
                onSuccess: () => {
                  toast.success('Lista eliminada.')
                  router.push('/lists')
                },
                onError: (error) => {
                  toast.error(error instanceof Error ? error.message : 'No se pudo eliminar.')
                },
              })
            }}
          >
            Eliminar
          </Button>
        )}
      </div>

      {showMembers && <ListMembers listId={listId} isOwner={isOwner} />}

      {timeline.isLoading ? (
        <TimelineSkeleton />
      ) : posts.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          Nadie en esta lista ha publicado todavía.
        </p>
      ) : (
        <PostFeedList
          posts={posts}
          hasNextPage={timeline.hasNextPage}
          isFetchingNextPage={timeline.isFetchingNextPage}
          fetchNextPage={timeline.fetchNextPage}
          ariaLabel={`Timeline de la lista ${list.name}`}
        />
      )}
    </div>
  )
}
