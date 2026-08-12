'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useCreatePost } from '@/lib/use-create-post'
import { useCurrentUser } from '@/lib/use-current-user'
import { type MediaAttachment, isReadyAttachment, useMediaUpload } from '@/lib/use-media-upload'
import { ALLOWED_IMAGE_MIME_TYPES, MEDIA_LIMITS } from '@x/utils/media'
import { MAX_POST_GRAPHEMES, countCharacters } from '@x/utils/text'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

type ComposerProps = {
  /** Set to compose a reply instead of a top-level post (ROADMAP.md 2.1) — threaded straight through to POST /posts, whose reply_policy enforcement can reject it. */
  inReplyToId?: string
  placeholder?: string
  /** Called after a successful post/reply, in addition to the built-in reset — e.g. the thread page uses it to router.refresh() so the new reply shows up in its server-rendered list. */
  onPosted?: () => void
}

export function Composer({
  inReplyToId,
  placeholder = '¿Qué está pasando?',
  onPosted,
}: ComposerProps = {}) {
  const [text, setText] = useState('')
  const { data: me } = useCurrentUser()
  const createPost = useCreatePost()
  const { attachments, addFiles, removeAttachment, reset: resetAttachments } = useMediaUpload()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const count = countCharacters(text)
  const remaining = MAX_POST_GRAPHEMES - count
  const isOverLimit = remaining < 0
  const readyMediaIds = attachments
    .filter(isReadyAttachment)
    .map((attachment) => attachment.mediaId)
  const isBusy = attachments.some((a) => a.status === 'uploading' || a.status === 'processing')
  const hasFailedAttachment = attachments.some((a) => a.status === 'error')
  const isEmpty = text.trim().length === 0 && readyMediaIds.length === 0
  const canSubmit =
    !isEmpty && !isOverLimit && !isBusy && !hasFailedAttachment && !createPost.isPending
  const canAttachMore = attachments.length < MEDIA_LIMITS.MAX_ATTACHMENTS_PER_POST

  const submit = () => {
    if (!canSubmit) return
    createPost.mutate(
      {
        text,
        ...(readyMediaIds.length > 0 && { mediaIds: readyMediaIds }),
        ...(inReplyToId !== undefined && { inReplyToId }),
        replyPolicy: 'everyone',
        isSensitive: false,
      },
      {
        onSuccess: () => {
          setText('')
          resetAttachments()
          onPosted?.()
        },
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
          placeholder={placeholder}
          aria-label="Redactar un post"
          rows={3}
          className="w-full resize-none rounded-md bg-transparent text-lg placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <AttachmentThumbnail
                key={attachment.localId}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.localId)}
              />
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_IMAGE_MIME_TYPES.join(',')}
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files && event.target.files.length > 0) {
                  addFiles(event.target.files)
                }
                event.target.value = ''
              }}
            />
            <button
              type="button"
              aria-label="Adjuntar imagen"
              title="Adjuntar imagen"
              disabled={!canAttachMore}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center rounded-full p-2 text-primary transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <ImageIcon />
            </button>
          </div>
          <div className="flex items-center gap-3">
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
    </div>
  )
}

function AttachmentThumbnail({
  attachment,
  onRemove,
}: {
  attachment: MediaAttachment
  onRemove: () => void
}) {
  return (
    <div className="relative h-20 w-20 overflow-hidden rounded-lg border border-border">
      <img src={attachment.previewUrl} alt="" className="h-full w-full object-cover" />
      {(attachment.status === 'uploading' || attachment.status === 'processing') && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
          <span
            aria-label="Subiendo imagen"
            className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
          />
        </div>
      )}
      {attachment.status === 'error' && (
        <div
          title={attachment.error}
          className="absolute inset-0 flex items-center justify-center bg-destructive/80 p-1 text-center text-[10px] leading-tight text-destructive-foreground"
        >
          No se pudo subir
        </div>
      )}
      <button
        type="button"
        aria-label="Quitar imagen"
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-xs leading-none text-foreground hover:bg-background"
      >
        ×
      </button>
    </div>
  )
}

function ImageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  )
}
