'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiClient } from '@/lib/api-client'
import { useCreateConversation } from '@/lib/use-conversations'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

/**
 * Starts a 1:1 by username (ROADMAP.md 2.5) — there's no user search yet
 * (2.3), so this resolves a single exact username via GET /users/:username
 * rather than a picker. POST /conversations reuses an existing thread with
 * that person instead of duplicating it.
 */
export function NewConversationForm() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [isResolving, setIsResolving] = useState(false)
  const createConversation = useCreateConversation()

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = username.trim().replace(/^@/, '')
    if (!trimmed) return

    setIsResolving(true)
    const { data, error } = await apiClient.GET('/users/{username}', {
      params: { path: { username: trimmed } },
    })
    setIsResolving(false)
    if (error) {
      toast.error('No se encontró a ese usuario.')
      return
    }

    createConversation.mutate(data.data.id, {
      onSuccess: (conversation) => {
        setUsername('')
        router.push(`/messages/${conversation.id}`)
      },
      onError: (mutationError) => {
        toast.error(
          mutationError instanceof Error ? mutationError.message : 'No se pudo iniciar el chat.',
        )
      },
    })
  }

  const isBusy = isResolving || createConversation.isPending

  return (
    <form onSubmit={onSubmit} className="flex gap-2 border-b border-border p-4">
      <Input
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        placeholder="Usuario (sin @)"
        aria-label="Usuario con quien empezar a chatear"
      />
      <Button type="submit" disabled={isBusy || username.trim().length === 0}>
        {isBusy ? 'Buscando…' : 'Nuevo mensaje'}
      </Button>
    </form>
  )
}
