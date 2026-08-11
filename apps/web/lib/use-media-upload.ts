'use client'

import { ALLOWED_IMAGE_MIME_TYPES, type AllowedImageMimeType, MEDIA_LIMITS } from '@x/utils/media'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { apiClient } from './api-client'

export type MediaAttachmentStatus = 'uploading' | 'processing' | 'ready' | 'error'

export type MediaAttachment = {
  localId: string
  file: File
  previewUrl: string
  status: MediaAttachmentStatus
  mediaId?: string
  error?: string
}

const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 30_000

function isAllowedImageMimeType(type: string): type is AllowedImageMimeType {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(type)
}

/** Narrows to attachments a post can actually be submitted with — ready and carrying the mediaId the upload-url step assigned. */
export function isReadyAttachment(
  attachment: MediaAttachment,
): attachment is MediaAttachment & { mediaId: string } {
  return attachment.status === 'ready' && attachment.mediaId !== undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

async function pollUntilReady(mediaId: string): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const { data, error } = await apiClient.GET('/media/{id}', {
      params: { path: { id: mediaId } },
    })
    if (error) throw new Error(error.error.message)
    if (data.data.status === 'ready') return
    if (data.data.status === 'failed') throw new Error('El procesamiento de la imagen falló.')
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error('El procesamiento de la imagen está tardando demasiado.')
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
      // Safe: addFiles only ever calls uploadOne for files that already
      // passed isAllowedImageMimeType.
      const mimeType = file.type as AllowedImageMimeType
      const { data: uploadData, error: uploadError } = await apiClient.POST('/media/upload-url', {
        body: { mimeType },
      })
      if (uploadError) throw new Error(uploadError.error.message)

      const putResponse = await fetch(uploadData.data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: file,
      })
      if (!putResponse.ok) throw new Error('No se pudo subir el archivo.')

      updateAttachment(localId, { status: 'processing', mediaId: uploadData.data.mediaId })

      const { data: finalizeData, error: finalizeError } = await apiClient.POST(
        '/media/{id}/finalize',
        { params: { path: { id: uploadData.data.mediaId } } },
      )
      if (finalizeError) throw new Error(finalizeError.error.message)
      if (finalizeData.data.status === 'failed') {
        throw new Error('El procesamiento de la imagen falló.')
      }
      if (finalizeData.data.status === 'pending') {
        await pollUntilReady(uploadData.data.mediaId)
      }

      updateAttachment(localId, { status: 'ready' })
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
    }))
    setAttachments((current) => [...current, ...newAttachments])
    for (const attachment of newAttachments) {
      void uploadOne(attachment.localId, attachment.file)
    }
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

  return { attachments, addFiles, removeAttachment, reset }
}
