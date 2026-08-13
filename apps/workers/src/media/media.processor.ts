import {
  IMAGE_VARIANT_FORMATS,
  MEDIA_LIMITS,
  MEDIA_VARIANT_WIDTHS,
  type MediaVariant,
  mediaGifMp4Key,
  mediaPosterKey,
  mediaVariantKey,
} from '@x/utils'
import { encode as encodeBlurhash } from 'blurhash'
import sharp from 'sharp'
import type { ContentScanResult } from './content-scan.js'
import { transcodeGif } from './gif-transcoder.js'
import type { MediaRepository } from './media.repository.js'
import { transcodeVideo } from './video-transcoder.js'

export type MediaStorage = {
  getObjectBuffer: (bucket: string, key: string) => Promise<Buffer>
  putObjectBuffer: (bucket: string, key: string, body: Buffer, contentType: string) => Promise<void>
}

export type MediaProcessorOptions = {
  repository: MediaRepository
  storage: MediaStorage
  bucket: string
  /**
   * Narrowed to a plain function, same DI shape as `storage` above — media.worker.ts
   * closes over the real repository/ClamAV config (content-scan.ts's own
   * `scanContent`) for production; unit tests substitute a fake that never
   * needs a real ClamAV or Postgres reachable, only media.integration.test.ts
   * does (real infra, CODESTYLE.md §14).
   */
  scanContent: (buffer: Buffer) => Promise<ContentScanResult>
}

const BLURHASH_SAMPLE_SIZE = 32
const BLURHASH_COMPONENTS = 4
const HLS_PLAYLIST_CONTENT_TYPE = 'application/vnd.apple.mpegurl'
const HLS_SEGMENT_CONTENT_TYPE = 'video/mp2t'

/**
 * Deliberately does not catch-and-mark-failed on its own for a *transcode*
 * failure: finalize.ts (apps/api) already validated this is a real,
 * decodable file within limits, so an exception past the scan step is most
 * likely transient infra (S3, memory pressure), not a bad file — letting it
 * throw lets BullMQ's configured retries do their job. media.worker.ts
 * marks the row failed only once retries are exhausted. A failed *scan* is
 * the one exception to that: SPECS.md §9.2's pipeline step 3 (ClamAV + a
 * known-content hash, content-scan.ts) runs first, for every kind, and its
 * own verdict — clean or not — is definitive (the same bytes always scan
 * the same way), so an infected/known-bad result marks the row failed
 * immediately here instead of throwing for BullMQ to retry pointlessly.
 * ClamAV being unreachable is different (infrastructure, not a verdict) and
 * still throws, same as everything else in this function.
 *
 * Branches by `row.kind` (ROADMAP.md 2.7 adds gif/video alongside 1.5's
 * original image-only path) — each kind's own transcoder (sharp for
 * images, ffmpeg-runner-backed gif-transcoder.ts/video-transcoder.ts for
 * the other two) owns the format-specific work; this function's job is only
 * to fetch the source once, scan it, dispatch, upload whatever comes back,
 * and mark the row ready.
 */
export function createMediaProcessor(options: MediaProcessorOptions) {
  return async function processMedia(mediaId: string): Promise<void> {
    const id = BigInt(mediaId)
    const row = await options.repository.findMediaById(id)
    if (!row) return // Deleted between enqueue and processing — nothing to do.

    const original = await options.storage.getObjectBuffer(options.bucket, row.storageKey)

    const scanResult = await options.scanContent(original)
    if (!scanResult.clean) {
      console.error(`media ${mediaId}: failed content scan — ${scanResult.reason}`)
      await options.repository.markFailed(id)
      return
    }

    if (row.kind === 'gif') {
      await processGif(options, mediaId, id, original)
    } else if (row.kind === 'video') {
      await processVideo(options, mediaId, id, original)
    } else {
      await processImage(options, mediaId, id, original)
    }
  }
}

async function processImage(
  options: MediaProcessorOptions,
  mediaId: string,
  id: bigint,
  original: Buffer,
): Promise<void> {
  // .rotate() bakes EXIF orientation into the pixels; not calling
  // .withMetadata() afterward is what actually strips the rest of EXIF
  // (sharp's default) — together, ROADMAP.md 1.5's "strip completo de
  // EXIF... aplicando orientación al píxel".
  const orientedBuffer = await sharp(original, {
    limitInputPixels: MEDIA_LIMITS.MAX_DIMENSION ** 2,
  })
    .rotate()
    .toBuffer()

  const metadata = await sharp(orientedBuffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) {
    throw new Error(`media ${mediaId}: could not read dimensions after orienting`)
  }

  const variants = await generateImageVariants(orientedBuffer, mediaId, width)
  const blurhash = await computeBlurhash(orientedBuffer)

  for (const variant of variants) {
    const contentType = `image/${variant.format}`
    const buffer = await variant.buffer
    await options.storage.putObjectBuffer(options.bucket, variant.key, buffer, contentType)
  }

  await options.repository.markReady(id, {
    width,
    height,
    blurhash,
    variants: variants.map(({ buffer: _buffer, ...variant }) => variant),
  })
}

async function processGif(
  options: MediaProcessorOptions,
  mediaId: string,
  id: bigint,
  original: Buffer,
): Promise<void> {
  const result = await transcodeGif(original)

  const mp4Key = mediaGifMp4Key(mediaId)
  const posterKey = mediaPosterKey(mediaId)
  await options.storage.putObjectBuffer(options.bucket, mp4Key, result.mp4, 'video/mp4')
  await options.storage.putObjectBuffer(options.bucket, posterKey, result.poster, 'image/webp')

  const blurhash = await computeBlurhash(result.poster)
  const variants: MediaVariant[] = [
    { width: result.width, height: result.height, format: 'mp4', key: mp4Key },
    { width: result.width, height: result.height, format: 'poster', key: posterKey },
  ]

  await options.repository.markReady(id, {
    width: result.width,
    height: result.height,
    blurhash,
    variants,
    durationMs: result.durationMs,
  })
}

async function processVideo(
  options: MediaProcessorOptions,
  mediaId: string,
  id: bigint,
  original: Buffer,
): Promise<void> {
  const result = await transcodeVideo(mediaId, original)

  const posterKey = mediaPosterKey(mediaId)
  await options.storage.putObjectBuffer(options.bucket, posterKey, result.poster, 'image/webp')
  await options.storage.putObjectBuffer(
    options.bucket,
    result.masterPlaylistKey,
    Buffer.from(result.masterPlaylist, 'utf8'),
    HLS_PLAYLIST_CONTENT_TYPE,
  )
  for (const rendition of result.renditions) {
    for (const file of rendition.files) {
      const contentType = file.key.endsWith('.m3u8')
        ? HLS_PLAYLIST_CONTENT_TYPE
        : HLS_SEGMENT_CONTENT_TYPE
      await options.storage.putObjectBuffer(options.bucket, file.key, file.buffer, contentType)
    }
  }

  const blurhash = await computeBlurhash(result.poster)
  const variants: MediaVariant[] = [
    { width: result.width, height: result.height, format: 'poster', key: posterKey },
    {
      width: result.width,
      height: result.height,
      format: 'hls-master',
      key: result.masterPlaylistKey,
    },
    ...result.renditions.map(
      (rendition): MediaVariant => ({
        width: rendition.width,
        height: rendition.height,
        format: 'hls',
        key: rendition.playlistKey,
        bandwidthBps: rendition.bandwidthBps,
      }),
    ),
  ]

  await options.repository.markReady(id, {
    width: result.width,
    height: result.height,
    blurhash,
    variants,
    durationMs: result.durationMs,
  })
}

type PendingVariant = MediaVariant & { buffer: Promise<Buffer> }

/** Every fixed tier (SPECS.md §9.2's 340/600/1200) plus "orig" (the image's own width) — deduplicated and never upscaled past the source. */
async function generateImageVariants(
  orientedBuffer: Buffer,
  mediaId: string,
  sourceWidth: number,
): Promise<PendingVariant[]> {
  const targetWidths = [...new Set([...MEDIA_VARIANT_WIDTHS, sourceWidth])].filter(
    (width) => width <= sourceWidth,
  )

  const variants: PendingVariant[] = []
  for (const targetWidth of targetWidths) {
    for (const format of IMAGE_VARIANT_FORMATS) {
      const pipeline = sharp(orientedBuffer).resize({
        width: targetWidth,
        withoutEnlargement: true,
      })
      const encoded = format === 'webp' ? pipeline.webp() : pipeline.avif()
      const buffer = encoded.toBuffer()
      const key = mediaVariantKey(mediaId, targetWidth, format)
      const variantHeight = await buffer
        .then((data) => sharp(data).metadata())
        .then((m) => m.height)
      variants.push({
        width: targetWidth,
        height: variantHeight ?? targetWidth,
        format,
        key,
        buffer,
      })
    }
  }
  return variants
}

/**
 * A small raw RGBA sample is exactly what the blurhash algorithm wants —
 * SPECS.md §9.2's "placeholder progresivo". Takes any raster buffer sharp
 * can decode, not just an oriented source image — media.processor.ts also
 * feeds it a GIF/video's own extracted poster frame (WebP), since SPECS.md's
 * blurhash step reads as applying to the whole pipeline, not just images.
 */
async function computeBlurhash(rasterBuffer: Buffer): Promise<string> {
  const { data, info } = await sharp(rasterBuffer)
    .resize(BLURHASH_SAMPLE_SIZE, BLURHASH_SAMPLE_SIZE, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  // `new Uint8ClampedArray(buffer)` copies values by index, not bytes — it
  // resolves through Buffer's own view semantics correctly regardless of
  // any underlying pooled-allocation offset, so no manual byteOffset math is needed.
  return encodeBlurhash(
    new Uint8ClampedArray(data),
    info.width,
    info.height,
    BLURHASH_COMPONENTS,
    BLURHASH_COMPONENTS,
  )
}
