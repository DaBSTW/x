import type { MediaItem } from '@x/contracts'
import {
  type AllowedImageMimeType,
  ForbiddenError,
  MEDIA_LIMITS,
  MEDIA_STATUS,
  type MediaProcessingJobData,
  NotFoundError,
  ValidationError,
  buildPublicUrl,
  detectImageMimeType,
  extensionForMimeType,
  generateId,
  mediaOriginalKey,
  pickPrimaryVariant,
} from '@x/utils'
// sharp here is metadata-only (a cheap, non-decoding read) to validate a
// just-uploaded file before ever queuing real work — apps/workers owns the
// actual transcoding. Reading real headers via sharp/libvips is far more
// robust than hand-rolling a dimension parser per image format.
import sharp from 'sharp'
import type { MediaRepository, MediaRow } from './media.repository.js'

export type MediaStorage = {
  createPresignedUploadUrl: (bucket: string, key: string, contentType: string) => Promise<string>
  headObjectSize: (bucket: string, key: string) => Promise<number | null>
  getObjectBuffer: (bucket: string, key: string) => Promise<Buffer>
  deleteObject: (bucket: string, key: string) => Promise<void>
}

export type EnqueueMediaProcessing = (data: MediaProcessingJobData) => Promise<void>

export type MediaServiceConfig = {
  bucket: string
  publicUrlBase: string
}

export type MediaService = ReturnType<typeof createMediaService>

export function createMediaService(
  repository: MediaRepository,
  storage: MediaStorage,
  enqueueProcessing: EnqueueMediaProcessing,
  config: MediaServiceConfig,
) {
  async function createUploadUrl(
    ownerId: bigint,
    mimeType: AllowedImageMimeType,
  ): Promise<{ mediaId: string; uploadUrl: string }> {
    const id = generateId()
    const key = mediaOriginalKey(id.toString(), extensionForMimeType(mimeType))

    await repository.insertMedia({ id, ownerId, storageKey: key, mimeType, sizeBytes: 0n })
    const uploadUrl = await storage.createPresignedUploadUrl(config.bucket, key, mimeType)

    return { mediaId: id.toString(), uploadUrl }
  }

  /** Validates synchronously (fast feedback) and enqueues the heavy work — ROADMAP.md 1.5's "valida y encola procesamiento". */
  async function finalize(
    mediaId: bigint,
    requesterId: bigint,
  ): Promise<{ id: string; status: 'pending' }> {
    const row = await getOwnedMediaOrThrow(mediaId, requesterId)

    const size = await storage.headObjectSize(config.bucket, row.storageKey)
    if (size === null) {
      throw new ValidationError('no file has been uploaded to the presigned URL yet')
    }
    if (size > MEDIA_LIMITS.MAX_SIZE_BYTES) {
      await failAndCleanup(row)
      throw new ValidationError(`file exceeds the ${MEDIA_LIMITS.MAX_SIZE_BYTES}-byte limit`, {
        sizeBytes: size,
      })
    }

    const buffer = await storage.getObjectBuffer(config.bucket, row.storageKey)

    // Magic bytes, never the client's declared Content-Type — ROADMAP.md 1.5.
    if (!detectImageMimeType(buffer)) {
      await failAndCleanup(row)
      throw new ValidationError('the uploaded file is not a recognized image format')
    }

    const metadata = await sharp(buffer, {
      limitInputPixels: MEDIA_LIMITS.MAX_DIMENSION ** 2,
    })
      .metadata()
      .catch(() => null)
    const dimensionsOk =
      metadata?.width !== undefined &&
      metadata.height !== undefined &&
      metadata.width <= MEDIA_LIMITS.MAX_DIMENSION &&
      metadata.height <= MEDIA_LIMITS.MAX_DIMENSION
    if (!dimensionsOk) {
      await failAndCleanup(row)
      throw new ValidationError(`image dimensions exceed ${MEDIA_LIMITS.MAX_DIMENSION}px`, {
        width: metadata?.width ?? null,
        height: metadata?.height ?? null,
      })
    }

    await enqueueProcessing({ mediaId: mediaId.toString() })
    return { id: mediaId.toString(), status: 'pending' }
  }

  async function getById(mediaId: bigint, requesterId: bigint): Promise<MediaItem> {
    const row = await getOwnedMediaOrThrow(mediaId, requesterId)
    return toMediaDto(row, config)
  }

  async function updateAltText(
    mediaId: bigint,
    requesterId: bigint,
    altText: string,
  ): Promise<MediaItem> {
    const updated = await repository.updateAltText(mediaId, requesterId, altText)
    if (!updated) throw new NotFoundError('media', mediaId.toString())
    return getById(mediaId, requesterId)
  }

  async function getOwnedMediaOrThrow(mediaId: bigint, requesterId: bigint): Promise<MediaRow> {
    const row = await repository.findMediaById(mediaId)
    if (!row) throw new NotFoundError('media', mediaId.toString())
    if (row.ownerId !== requesterId) throw new ForbiddenError('this media belongs to another user')
    return row
  }

  async function failAndCleanup(row: MediaRow): Promise<void> {
    await repository.markFailed(row.id)
    try {
      await storage.deleteObject(config.bucket, row.storageKey)
    } catch {
      // Best-effort: an orphaned object in the bucket is a non-issue: failing
      // the request that's already reporting a validation error would be.
    }
  }

  return { createUploadUrl, finalize, getById, updateAltText }
}

export function toMediaDto(row: MediaRow, config: MediaServiceConfig): MediaItem {
  const status =
    row.status === MEDIA_STATUS.READY
      ? 'ready'
      : row.status === MEDIA_STATUS.FAILED
        ? 'failed'
        : 'pending'
  const variants = row.variants.map((variant) => ({
    width: variant.width,
    height: variant.height,
    format: variant.format,
    url: buildPublicUrl(config.publicUrlBase, config.bucket, variant.key),
  }))
  const primary = pickPrimaryVariant(variants)

  return {
    id: row.id.toString(),
    kind: row.kind,
    status,
    url:
      status === 'ready'
        ? (primary?.url ?? buildPublicUrl(config.publicUrlBase, config.bucket, row.storageKey))
        : null,
    width: row.width,
    height: row.height,
    blurhash: row.blurhash,
    altText: row.altText,
    variants,
  }
}
