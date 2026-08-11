'use client'

import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/format'
import { useConversation } from '@/lib/use-conversations'
import { useCurrentUser } from '@/lib/use-current-user'
import { useMarkRead, useMessages, useSendMessage } from '@/lib/use-messages'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type ChatViewProps = {
  conversationId: string
}

export function ChatView({ conversationId }: ChatViewProps) {
  const { data: me } = useCurrentUser()
  const { data: conversation } = useConversation(conversationId)
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useMessages(conversationId)
  const sendMessage = useSendMessage(conversationId)
  const markRead = useMarkRead(conversationId)
  const [text, setText] = useState('')

  // Pages arrive newest-first (same convention as every other list); a chat
  // reads oldest-first, so flatten in reverse instead of asking the backend
  // for a different order it doesn't otherwise need.
  const messages = data?.pages.flatMap((page) => page.data).reverse() ?? []
  const latestMessageId = data?.pages[0]?.data[0]?.id

  // Opening a chat implicitly means reading it — unlike the notifications
  // list (ROADMAP.md 1.7), which keeps an explicit "mark all read" button on
  // purpose, every chat app's baseline behavior is auto-read-on-open, so
  // this is a deliberate, narrow exception to CODESTYLE.md §11's default.
  // markRead is left out of the deps below on purpose too: it's a fresh
  // useMutation object every render, and lastMarkedRef already guards
  // against re-sending once per latestMessageId regardless.
  const lastMarkedRef = useRef<string | undefined>(undefined)
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    if (!latestMessageId || latestMessageId === lastMarkedRef.current) return
    lastMarkedRef.current = latestMessageId
    markRead.mutate(latestMessageId)
  }, [latestMessageId])

  const others = conversation?.members.filter((member) => member.id !== me?.id) ?? []
  const title = conversation?.isGroup
    ? (conversation.name ?? others.map((o) => o.displayName).join(', '))
    : (others[0]?.displayName ?? '')

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    sendMessage.mutate(trimmed, {
      onSuccess: () => setText(''),
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'No se pudo enviar el mensaje.')
      },
    })
  }

  return (
    <div className="flex flex-col">
      <h1 className="border-b border-border p-4 text-xl font-bold">{title || 'Conversación'}</h1>

      <div className="flex flex-col gap-2 p-4">
        {hasNextPage && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
            className="self-center"
          >
            {isFetchingNextPage ? 'Cargando…' : 'Cargar mensajes anteriores'}
          </Button>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : messages.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Todavía no hay mensajes. Di hola.
          </p>
        ) : (
          messages.map((message) => {
            const isMine = message.senderId === me?.id
            return (
              <div
                key={message.id}
                className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
              >
                <p
                  className={`max-w-xs rounded-2xl px-4 py-2 text-sm ${
                    isMine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                  }`}
                >
                  {message.text}
                </p>
                <time className="mt-0.5 text-xs text-muted-foreground">
                  {formatRelativeTime(message.createdAt)}
                </time>
              </div>
            )
          })
        )}
      </div>

      <form onSubmit={onSubmit} className="flex gap-2 border-t border-border p-4">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Escribe un mensaje"
          aria-label="Escribe un mensaje"
          rows={1}
          className="w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
        />
        <Button type="submit" disabled={sendMessage.isPending || text.trim().length === 0}>
          Enviar
        </Button>
      </form>
    </div>
  )
}
