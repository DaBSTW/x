import type { MediaItem } from '@x/contracts'
import {
  type AllowedMediaMimeType,
  ForbiddenError,
  MEDIA_LIMITS,
  MEDIA_STATUS,
  type MediaKind,
  type MediaProcessingJobData,
  type MediaVariantFormat,
  NotFoundError,
  ValidationError,
  buildPublicUrl,
  detectGifMimeType,
  detectImageMimeType,
  detectVideoMimeType,
  extensionForMimeType,
  generateId,
  mediaKindForMimeType,
  mediaOriginalKey,
  pickHlsMasterVariant,
  pickMp4Variant,
  pickPosterVariant,
  pickPrimaryVariant,
  probeVideo,
} from '@x/utils'
// sharp here is metadata-only (a cheap, non-decoding read) to validate a
// just-uploaded file before ever queuing real work — apps/workers owns the
// actual transcoding. Reading real headers via sharp/libvips is far more
// robust than hand-rolling a dimension parser per image format. Used for
// GIF too — sharp reads a GIF's own header the same way, no separate parser.
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
    mimeType: AllowedMediaMimeType,
  ): Promise<{ mediaId: string; uploadUrl: string }> {
    const id = generateId()
    const kind = mediaKindForMimeType(mimeType)
    const key = mediaOriginalKey(id.toString(), extensionForMimeType(mimeType))

    await repository.insertMedia({ id, ownerId, storageKey: key, mimeType, sizeBytes: 0n, kind })
    const uploadUrl = await storage.createPresignedUploadUrl(config.bucket, key, mimeType)

    return { mediaId: id.toString(), uploadUrl }
  }

  /**
   * Validates synchronously (fast feedback) and enqueues the heavy work —
   * ROADMAP.md 1.5's "valida y encola procesamiento", extended to GIF/video
   * in 2.7. Each kind gets its own size limit and its own magic-byte check
   * (SPECS.md §9.2's per-kind table); video additionally needs a real
   * duration read (ffprobe, via @x/utils' probeVideo — a fast metadata-only
   * read, not a transcode, so it's fine to run inline here) against the
   * 140 s / 2 h-para-verificados budget.
   */
  async function finalize(
    mediaId: bigint,
    requesterId: bigint,
  ): Promise<{ id: string; status: 'pending' }> {
    const row = await getOwnedMediaOrThrow(mediaId, requesterId)

    if (row.kind === 'gif') {
      await finalizeGif(row)
    } else if (row.kind === 'video') {
      await finalizeVideo(row, requesterId)
    } else {
      await finalizeImage(row)
    }

    await enqueueProcessing({ mediaId: mediaId.toString() })
    return { id: mediaId.toString(), status: 'pending' }
  }

  async function finalizeImage(row: MediaRow): Promise<void> {
    const buffer = await requireUploadedBuffer(row, MEDIA_LIMITS.MAX_SIZE_BYTES)

    // Magic bytes, never the client's declared Content-Type — ROADMAP.md 1.5.
    if (!detectImageMimeType(buffer)) {
      await failAndCleanup(row)
      throw new ValidationError('the uploaded file is not a recognized image format')
    }

    await requireDimensionsWithinLimit(row, buffer)
  }

  async function finalizeGif(row: MediaRow): Promise<void> {
    const buffer = await requireUploadedBuffer(row, MEDIA_LIMITS.MAX_GIF_SIZE_BYTES)

    if (!detectGifMimeType(buffer)) {
      await failAndCleanup(row)
      throw new ValidationError('the uploaded file is not a recognized GIF')
    }

    await requireDimensionsWithinLimit(row, buffer)
  }

  /** Same decompression-bomb / dimension guard for both images and GIFs — a GIF frame decodes through the same libvips path sharp uses for everything else. */
  async function requireDimensionsWithinLimit(row: MediaRow, buffer: Buffer): Promise<void> {
    const metadata = await readImageMetadata(buffer)
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
  }

  async function finalizeVideo(row: MediaRow, requesterId: bigint): Promise<void> {
    const buffer = await requireUploadedBuffer(row, MEDIA_LIMITS.MAX_VIDEO_SIZE_BYTES)

    if (!detectVideoMimeType(buffer)) {
      await failAndCleanup(row)
      throw new ValidationError('the uploaded file is not a recognized video format')
    }

    const probed = await probeVideo(buffer)
    if (!probed) {
      await failAndCleanup(row)
      throw new ValidationError('could not read a duration from the uploaded video')
    }

    // SPECS.md §9.2: 140 s, 2 h for verified accounts — a fresh DB read, not
    // something the access token carries (verification status can change
    // between when a token was issued and when a video is finalized).
    const isVerified = await repository.findOwnerIsVerified(requesterId)
    const maxDurationSeconds = isVerified
      ? MEDIA_LIMITS.MAX_VIDEO_DURATION_SECONDS_VERIFIED
      : MEDIA_LIMITS.MAX_VIDEO_DURATION_SECONDS
    if (probed.durationMs > maxDurationSeconds * 1000) {
      await failAndCleanup(row)
      throw new ValidationError(`video duration exceeds ${maxDurationSeconds}s`, {
        durationMs: probed.durationMs,
        maxDurationSeconds,
      })
    }
  }

  async function requireUploadedBuffer(row: MediaRow, maxSizeBytes: number): Promise<Buffer> {
    const size = await storage.headObjectSize(config.bucket, row.storageKey)
    if (size === null) {
      throw new ValidationError('no file has been uploaded to the presigned URL yet')
    }
    if (size > maxSizeBytes) {
      await failAndCleanup(row)
      throw new ValidationError(`file exceeds the ${maxSizeBytes}-byte limit`, { sizeBytes: size })
    }
    return storage.getObjectBuffer(config.bucket, row.storageKey)
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

/**
 * A `try`/`catch` around the *whole* read, not a `.catch()` chained only
 * onto `.metadata()` — `sharp(buffer, opts)` itself can throw synchronously,
 * before `.metadata()` is ever reached to attach a handler to, and a
 * synchronous throw inside an `async function` still becomes a rejected
 * promise nothing here was actually listening for. Found the hard way: a
 * genuinely malformed/hostile upload must always degrade to a clean 400 in
 * finalize(), never crash the request as an uncaught 500 — verified against
 * a real corrupt buffer, not just reasoned about, once found.
 */
async function readImageMetadata(buffer: Buffer): Promise<sharp.Metadata | null> {
  try {
    return await sharp(buffer, { limitInputPixels: MEDIA_LIMITS.MAX_DIMENSION ** 2 }).metadata()
  } catch {
    return null
  }
}

type MediaVariantWithUrl = {
  width: number
  height: number
  format: MediaVariantFormat
  url: string
}

/** `url` means something different per kind — the widest image variant, a GIF's transcoded MP4, or a video's HLS *master* playlist (never one rendition). `posterUrl`/`durationMs` stay null for images — there's no separate poster frame or duration for a still. */
function urlForKind(kind: MediaKind, variants: MediaVariantWithUrl[]): string | undefined {
  if (kind === 'gif') return pickMp4Variant(variants)?.url
  if (kind === 'video') return pickHlsMasterVariant(variants)?.url
  return pickPrimaryVariant(variants)?.url
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
  const primaryUrl = urlForKind(row.kind, variants)

  return {
    id: row.id.toString(),
    kind: row.kind,
    status,
    url:
      status === 'ready'
        ? (primaryUrl ?? buildPublicUrl(config.publicUrlBase, config.bucket, row.storageKey))
        : null,
    posterUrl: pickPosterVariant(variants)?.url ?? null,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    blurhash: row.blurhash,
    altText: row.altText,
    variants,
  }
}
