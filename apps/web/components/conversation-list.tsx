'use client'

import { formatRelativeTime } from '@/lib/format'
import { useConversations } from '@/lib/use-conversations'
import { useCurrentUser } from '@/lib/use-current-user'
import Link from 'next/link'

export function ConversationList() {
  const { data: me } = useCurrentUser()
  const { data: conversations, isLoading, isError } = useConversations()

  if (isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
  }
  if (isError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        No se pudieron cargar tus conversaciones.
      </p>
    )
  }
  if (!conversations || conversations.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        Todavía no tienes conversaciones.
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {conversations.map((conversation) => {
        const others = conversation.members.filter((member) => member.id !== me?.id)
        const title = conversation.isGroup
          ? (conversation.name ?? others.map((o) => o.displayName).join(', '))
          : (others[0]?.displayName ?? 'Conversación')

        return (
          <li key={conversation.id}>
            <Link
              href={`/messages/${conversation.id}`}
              className="flex items-center justify-between gap-3 p-4 hover:bg-muted"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{title}</span>
                {conversation.lastMessageAt && (
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(conversation.lastMessageAt)}
                  </span>
                )}
              </div>
              {conversation.unreadCount > 0 && (
                <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs leading-none text-primary-foreground">
                  {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                </span>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
