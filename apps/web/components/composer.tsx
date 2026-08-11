'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useCreatePost } from '@/lib/use-create-post'
import { useCurrentUser } from '@/lib/use-current-user'
import { MAX_POST_GRAPHEMES, countCharacters } from '@x/utils/text'
import { useState } from 'react'
import { toast } from 'sonner'

export function Composer() {
  const [text, setText] = useState('')
  const { data: me } = useCurrentUser()
  const createPost = useCreatePost()

  const count = countCharacters(text)
  const remaining = MAX_POST_GRAPHEMES - count
  const isOverLimit = remaining < 0
  const isEmpty = text.trim().length === 0
  const canSubmit = !isEmpty && !isOverLimit && !createPost.isPending

  const submit = () => {
    if (!canSubmit) return
    createPost.mutate(
      { text, replyPolicy: 'everyone', isSensitive: false },
      {
        onSuccess: () => setText(''),
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'No se pudo publicar el post.')
        },
      },
    )
  }

  return (
    <div className="flex gap-3 border-b border-border p-4">
      <Avatar>
        <AvatarImage src={me?.avatarUrl ?? undefined} alt="" />
        <AvatarFallback>{(me?.displayName ?? '?').slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex flex-1 flex-col gap-3">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="¿Qué está pasando?"
          aria-label="Redactar un post"
          rows={3}
          className="w-full resize-none bg-transparent text-lg placeholder:text-muted-foreground focus-visible:outline-none"
        />
        <div className="flex items-center justify-end gap-3">
          <span
            className={cn(
              'text-sm tabular-nums',
              isOverLimit ? 'text-destructive' : 'text-muted-foreground',
            )}
            aria-live="polite"
          >
            {remaining}
          </span>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {createPost.isPending ? 'Publicando…' : 'Postear'}
          </Button>
        </div>
      </div>
    </div>
  )
}
