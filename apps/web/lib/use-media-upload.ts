'use client'

import { MEDIA_LIMITS } from '@x/utils/media'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { apiClient } from './api-client'
import { isAllowedImageMimeType, uploadImage } from './upload-image.js'

export type MediaAttachmentStatus = 'uploading' | 'processing' | 'ready' | 'error'

export type MediaAttachment = {
  localId: string
  file: File
  previewUrl: string
  status: MediaAttachmentStatus
  mediaId?: string
  error?: string
  /** ROADMAP.md 1.8: editable from the composer, not just settable at upload time — PATCH /media/:id already existed since 1.5, this is the client finally calling it. */
  altText: string
}

/** Narrows to attachments a post can actually be submitted with — ready and carrying the mediaId the upload-url step assigned. */
export function isReadyAttachment(
  attachment: MediaAttachment,
): attachment is MediaAttachment & { mediaId: string } {
  return attachment.status === 'ready' && attachment.mediaId !== undefined
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * Orchestrates the upload flow `<Composer>` needs (ROADMAP.md 1.8): pick a
 * file → `POST /media/upload-url` → PUT the bytes straight to S3/MinIO →
 * `POST /media/:id/finalize` → poll `GET /media/:id` until the worker (1.5)
 * marks it ready or failed. `attachments` is local component state, not a
 * query — there's nothing to cache or share, and it's gone the moment the
 * post is submitted or discarded.
 */
export function useMediaUpload() {
  const [attachments, setAttachments] = useState<MediaAttachment[]>([])
  const nextId = useRef(0)

  function updateAttachment(localId: string, patch: Partial<MediaAttachment>) {
    setAttachments((current) =>
      current.map((attachment) =>
        attachment.localId === localId ? { ...attachment, ...patch } : attachment,
      ),
    )
  }

  async function uploadOne(localId: string, file: File) {
    try {
      // uploadImage() (lib/upload-image.ts) covers upload-url → PUT →
      // finalize → poll in one call — composer.tsx never actually
      // distinguishes 'uploading' from 'processing' visually (same spinner,
      // same isBusy check), so collapsing that intermediate status update
      // changes nothing a user or a test can observe.
      const mediaId = await uploadImage(file)
      updateAttachment(localId, { status: 'ready', mediaId })
    } catch (error) {
      updateAttachment(localId, {
        status: 'error',
        error: errorMessage(error, 'No se pudo subir la imagen.'),
      })
    }
  }

  function addFiles(fileList: FileList | File[]) {
    const remainingSlots = MEDIA_LIMITS.MAX_ATTACHMENTS_PER_POST - attachments.length
    if (remainingSlots <= 0) {
      toast.error(`Ya adjuntaste el máximo de ${MEDIA_LIMITS.MAX_ATTACHMENTS_PER_POST} imágenes.`)
      return
    }

    const accepted: File[] = []
    for (const file of Array.from(fileList)) {
      if (accepted.length >= remainingSlots) break
      if (!isAllowedImageMimeType(file.type)) {
        toast.error(`${file.name}: formato no admitido.`)
        continue
      }
      if (file.size > MEDIA_LIMITS.MAX_SIZE_BYTES) {
        toast.error(`${file.name}: supera el tamaño máximo de 5 MB.`)
        continue
      }
      accepted.push(file)
    }
    if (accepted.length === 0) return

    const newAttachments: MediaAttachment[] = accepted.map((file) => ({
      localId: `media-${nextId.current++}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
      altText: '',
    }))
    setAttachments((current) => [...current, ...newAttachments])
    for (const attachment of newAttachments) {
      void uploadOne(attachment.localId, attachment.file)
    }
  }

  /**
   * PATCH /media/:id — doesn't require the attachment to be `ready` yet
   * (the service only checks ownership), but `mediaId` has to exist, so an
   * attachment still in the earliest moment of `uploading` (before
   * upload-url even returns) has nothing to save against yet.
   */
  async function updateAltText(localId: string, altText: string): Promise<void> {
    const attachment = attachments.find((candidate) => candidate.localId === localId)
    if (!attachment?.mediaId) return

    const { error } = await apiClient.PATCH('/media/{id}', {
      params: { path: { id: attachment.mediaId } },
      body: { altText },
    })
    if (error) throw new Error(error.error.message)
    updateAttachment(localId, { altText })
  }

  function removeAttachment(localId: string) {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.localId === localId)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((attachment) => attachment.localId !== localId)
    })
  }

  function reset() {
    setAttachments((current) => {
      for (const attachment of current) URL.revokeObjectURL(attachment.previewUrl)
      return []
    })
  }

  return { attachments, addFiles, removeAttachment, updateAltText, reset }
}
