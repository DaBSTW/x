'use client'

import { NotificationsList } from '@/components/notifications-list'
import { Button } from '@/components/ui/button'
import { useMarkNotificationsRead } from '@/lib/use-mark-notifications-read'
import { useNotifications } from '@/lib/use-notifications'

export default function NotificationsPage() {
  // Same query key as <NotificationsList>'s own useNotifications() — TanStack
  // Query dedupes by key, so this doesn't add a second request, just reads
  // the newest id for the button below.
  const { data } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const newestId = data?.pages[0]?.data[0]?.id

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h1 className="text-xl font-bold">Notificaciones</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!newestId || markRead.isPending}
          onClick={() => newestId && markRead.mutate(newestId)}
        >
          Marcar todo como leído
        </Button>
      </div>
      <NotificationsList />
    </div>
  )
}
