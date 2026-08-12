import { ALLOWED_IMAGE_MIME_TYPES, type AllowedImageMimeType, MEDIA_LIMITS } from '@x/utils/media'
import { apiClient } from './api-client'

const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 30_000

export function isAllowedImageMimeType(type: string): type is AllowedImageMimeType {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(type)
}

/** `file` must already have passed {@link isAllowedImageMimeType} and MEDIA_LIMITS.MAX_SIZE_BYTES — callers validate before calling, same as use-media-upload.ts's addFiles does today. */
export function validateImageFile(file: File): string | null {
  if (!isAllowedImageMimeType(file.type)) return `${file.name}: formato no admitido.`
  if (file.size > MEDIA_LIMITS.MAX_SIZE_BYTES)
    return `${file.name}: supera el tamaño máximo de 5 MB.`
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
 * `POST /media/upload-url` → PUT the bytes straight to S3/MinIO →
 * `POST /media/:id/finalize` → poll `GET /media/:id` until the worker
 * (ROADMAP.md 1.5) marks it ready or throws. Shared by use-media-upload.ts
 * (up to 4 post attachments, with alt text and per-attachment status) and
 * profile-edit-dialog.tsx (exactly one image at a time, avatar or banner,
 * ROADMAP.md 1.6) — both need the exact same four-step round trip, just a
 * different shape of state wrapped around it.
 */
export async function uploadImage(file: File): Promise<string> {
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

  return uploadData.data.mediaId
}
