import { FollowRequestsList } from '@/components/follow-requests-list'

export default function FollowRequestsPage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="border-b border-border pb-4 text-xl font-bold">Solicitudes de seguimiento</h1>
      <FollowRequestsList />
    </div>
  )
}
