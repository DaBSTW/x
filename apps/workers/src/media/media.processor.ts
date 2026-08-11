import {
  MEDIA_LIMITS,
  MEDIA_VARIANT_FORMATS,
  MEDIA_VARIANT_WIDTHS,
  type MediaVariant,
  mediaVariantKey,
} from '@x/utils'
import { encode as encodeBlurhash } from 'blurhash'
import sharp from 'sharp'
import type { MediaRepository } from './media.repository.js'

export type MediaStorage = {
  getObjectBuffer: (bucket: string, key: string) => Promise<Buffer>
  putObjectBuffer: (bucket: string, key: string, body: Buffer, contentType: string) => Promise<void>
}

export type MediaProcessorOptions = {
  repository: MediaRepository
  storage: MediaStorage
  bucket: string
}

const BLURHASH_SAMPLE_SIZE = 32
const BLURHASH_COMPONENTS = 4

/**
 * Deliberately does not catch-and-mark-failed on its own: finalize.ts (apps/api)
 * already validated this is a real, decodable image within limits, so an
 * exception here is most likely transient infra (S3, memory pressure), not a
 * bad file — letting it throw lets BullMQ's configured retries do their job.
 * media.worker.ts marks the row failed only once retries are exhausted.
 */
export function createMediaProcessor(options: MediaProcessorOptions) {
  return async function processMedia(mediaId: string): Promise<void> {
    const id = BigInt(mediaId)
    const row = await options.repository.findMediaById(id)
    if (!row) return // Deleted between enqueue and processing — nothing to do.

    const original = await options.storage.getObjectBuffer(options.bucket, row.storageKey)

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

    const variants = await generateVariants(orientedBuffer, mediaId, width)
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
}

type PendingVariant = MediaVariant & { buffer: Promise<Buffer> }

/** Every fixed tier (SPECS.md §9.2's 340/600/1200) plus "orig" (the image's own width) — deduplicated and never upscaled past the source. */
async function generateVariants(
  orientedBuffer: Buffer,
  mediaId: string,
  sourceWidth: number,
): Promise<PendingVariant[]> {
  const targetWidths = [...new Set([...MEDIA_VARIANT_WIDTHS, sourceWidth])].filter(
    (width) => width <= sourceWidth,
  )

  const variants: PendingVariant[] = []
  for (const targetWidth of targetWidths) {
    for (const format of MEDIA_VARIANT_FORMATS) {
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

/** A small raw RGBA sample is exactly what the blurhash algorithm wants — SPECS.md §9.2's "placeholder progresivo". */
async function computeBlurhash(orientedBuffer: Buffer): Promise<string> {
  const { data, info } = await sharp(orientedBuffer)
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
