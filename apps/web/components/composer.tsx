'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
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
  /** Set to compose a quote instead of a top-level post (ROADMAP.md 2.1 "Citas") — <QuoteComposerDialog> is the one caller today. Mutually exclusive with inReplyToId in practice (nothing currently opens a Composer with both), but nothing here enforces that; POST /posts itself only branches on inReplyToId first. */
  quotedPostId?: string
  placeholder?: string
  /** Called after a successful post/reply/quote, in addition to the built-in reset — e.g. the thread page uses it to router.refresh() so the new reply shows up in its server-rendered list. */
  onPosted?: () => void
}

export function Composer({
  inReplyToId,
  quotedPostId,
  placeholder = '¿Qué está pasando?',
  onPosted,
}: ComposerProps = {}) {
  const [text, setText] = useState('')
  const { data: me } = useCurrentUser()
  const createPost = useCreatePost()
  const {
    attachments,
    addFiles,
    removeAttachment,
    updateAltText,
    reset: resetAttachments,
  } = useMediaUpload()
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
        ...(quotedPostId !== undefined && { quotedPostId }),
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
                onSaveAltText={(altText) => updateAltText(attachment.localId, altText)}
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
  onSaveAltText,
}: {
  attachment: MediaAttachment
  onRemove: () => void
  onSaveAltText: (altText: string) => Promise<void>
}) {
  const [isEditingAlt, setIsEditingAlt] = useState(false)
  // Forces AltTextDialog to remount on every open — see its own comment on
  // why that's what actually reseeds its draft from attachment.altText,
  // instead of a stale value left over from a previous cancelled edit.
  const [dialogInstance, setDialogInstance] = useState(0)

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
      {/* PATCH /media/:id only needs ownership, not `ready` (media.service.ts's updateAltText) — the button just needs a mediaId to save against, which exists from the moment upload-url returns. */}
      {attachment.mediaId && (
        <button
          type="button"
          aria-label={attachment.altText ? 'Editar texto alternativo' : 'Añadir texto alternativo'}
          onClick={() => {
            setDialogInstance((current) => current + 1)
            setIsEditingAlt(true)
          }}
          className={cn(
            'absolute bottom-1 left-1 rounded bg-background/80 px-1 text-[10px] font-semibold leading-tight hover:bg-background',
            attachment.altText ? 'text-primary' : 'text-foreground',
          )}
        >
          ALT
        </button>
      )}
      <AltTextDialog
        key={dialogInstance}
        open={isEditingAlt}
        initialValue={attachment.altText}
        onOpenChange={setIsEditingAlt}
        onSave={onSaveAltText}
      />
    </div>
  )
}

/**
 * `key`ed by AttachmentThumbnail on every open (a plain counter bumped in
 * the click handler) — the whole point being that this component remounts
 * fresh each time, so `useState(initialValue)` below always re-seeds from
 * the attachment's actual saved altText instead of a stale draft left over
 * from a previous cancelled edit. A `useEffect` watching `open` to reset
 * `draft` would work too, but CODESTYLE.md §11 treats that class of
 * prop→state sync as exactly the effect usage to avoid.
 */
function AltTextDialog({
  open,
  initialValue,
  onOpenChange,
  onSave,
}: {
  open: boolean
  initialValue: string
  onOpenChange: (open: boolean) => void
  onSave: (altText: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(initialValue)
  const [isSaving, setIsSaving] = useState(false)

  async function save() {
    setIsSaving(true)
    try {
      await onSave(draft)
      onOpenChange(false)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo guardar el texto alternativo.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Texto alternativo</DialogTitle>
        <p className="text-sm text-muted-foreground">
          Describe la imagen para las personas que usan lectores de pantalla.
        </p>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={1000}
          rows={4}
          aria-label="Texto alternativo"
          className="w-full resize-none rounded-md border border-border bg-transparent p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} disabled={isSaving}>
            {isSaving ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
