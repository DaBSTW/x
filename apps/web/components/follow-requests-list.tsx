'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  useAcceptFollowRequest,
  useFollowRequests,
  useRejectFollowRequest,
} from '@/lib/use-follow-requests'
import Link from 'next/link'
import { toast } from 'sonner'

/** ROADMAP.md 2.6 "cuentas protegidas" — pending requests to follow the caller, each with an accept/reject action. */
export function FollowRequestsList() {
  const { data: requests, isLoading } = useFollowRequests()
  const accept = useAcceptFollowRequest()
  const reject = useRejectFollowRequest()

  if (isLoading || !requests) {
    return <p className="text-sm text-muted-foreground">Cargando solicitudes…</p>
  }

  if (requests.length === 0) {
    return <p className="text-sm text-muted-foreground">No tienes solicitudes pendientes.</p>
  }

  function onAccept(id: string) {
    accept.mutate(id, {
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'No se pudo aceptar la solicitud.')
      },
    })
  }

  function onReject(id: string) {
    reject.mutate(id, {
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'No se pudo rechazar la solicitud.')
      },
    })
  }

  return (
    <ul aria-label="Solicitudes de seguimiento" className="flex flex-col gap-4">
      {requests.map((requester) => (
        <li key={requester.id} className="flex items-center justify-between gap-4">
          <Link href={`/${requester.username}`} className="flex items-center gap-3">
            <Avatar>
              <AvatarImage src={requester.avatarUrl ?? undefined} alt="" />
              <AvatarFallback>{requester.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium">{requester.displayName}</span>
              <span className="text-sm text-muted-foreground">@{requester.username}</span>
            </div>
          </Link>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => onAccept(requester.id)}
              disabled={accept.isPending || reject.isPending}
            >
              Aceptar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onReject(requester.id)}
              disabled={accept.isPending || reject.isPending}
            >
              Rechazar
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}
