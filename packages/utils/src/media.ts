// Shared between apps/api (producer: upload-url + finalize) and apps/workers
// (consumer: transcoding), same reason queues.ts and notifications.ts are
// shared — SPECS.md §3, ROADMAP.md 1.5.

export const MEDIA_PROCESSING_QUEUE_NAME = 'media-processing'

export type MediaProcessingJobData = {
  mediaId: string
}

// 0 pending, 1 ready, 2 failed — mirrors SPECS.md §4.2's `media.status` column.
export const MEDIA_STATUS = { PENDING: 0, READY: 1, FAILED: 2 } as const
export type MediaStatus = (typeof MEDIA_STATUS)[keyof typeof MEDIA_STATUS]

export const MEDIA_LIMITS = {
  // SPECS.md §9.2's image row: 5 MB, 8192×8192. The same dimension cap also
  // doubles as the decompression-bomb pixel budget passed to sharp's
  // `limitInputPixels` — libvips refuses to decode past it, so a tiny file
  // that claims an enormous canvas is rejected before it can exhaust memory.
  MAX_SIZE_BYTES: 5 * 1024 * 1024,
  MAX_DIMENSION: 8192,
  MAX_ATTACHMENTS_PER_POST: 4,
} as const

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
] as const
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number]

// "orig" (SPECS.md §9.2) isn't a fixed width — it's the source image's own
// width, capped at MAX_DIMENSION. Callers add it themselves.
export const MEDIA_VARIANT_WIDTHS = [340, 600, 1200] as const
export const MEDIA_VARIANT_FORMATS = ['webp', 'avif'] as const
export type MediaVariantFormat = (typeof MEDIA_VARIANT_FORMATS)[number]

export type MediaVariant = {
  width: number
  height: number
  format: MediaVariantFormat
  key: string
}

export function mediaOriginalKey(mediaId: string, extension: string): string {
  return `media/${mediaId}/original.${extension}`
}

export function mediaVariantKey(
  mediaId: string,
  width: number,
  format: MediaVariantFormat,
): string {
  return `media/${mediaId}/${width}.${format}`
}

/**
 * The variant a caller gets when it just wants "a reasonable image URL", not
 * a specific size — the widest WebP variant (every modern reader decodes
 * WebP; AVIF is the smaller-but-narrower-supported alternative offered
 * alongside it, not instead of it). Generic so it works on both the raw
 * storage-key-bearing rows and a URL-bearing DTO shape.
 */
export function pickPrimaryVariant<V extends { width: number; format: MediaVariantFormat }>(
  variants: V[],
): V | undefined {
  const webpVariants = variants.filter((variant) => variant.format === 'webp')
  const candidates = webpVariants.length > 0 ? webpVariants : variants
  return candidates.reduce<V | undefined>(
    (best, variant) => (variant.width > (best?.width ?? 0) ? variant : best),
    undefined,
  )
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const ISOBMFF_AVIF_BRANDS = ['avif', 'avis']
const ISOBMFF_HEIC_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1']

function isIsobmffBrand(buffer: Buffer, brands: string[]): boolean {
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') return false
  return brands.includes(buffer.toString('ascii', 8, 12))
}

/**
 * Sniffs the real image format from the file's own bytes — SPECS.md §9.2 /
 * ROADMAP.md 1.5: "nunca por Content-Type del cliente". Returns `null` for
 * anything unrecognized, including a file whose Content-Type merely claims
 * to be one of these formats without matching its signature.
 */
export function detectImageMimeType(buffer: Buffer): AllowedImageMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buffer.length >= 8 && PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)) {
    return 'image/png'
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (isIsobmffBrand(buffer, ISOBMFF_AVIF_BRANDS)) return 'image/avif'
  if (isIsobmffBrand(buffer, ISOBMFF_HEIC_BRANDS)) return 'image/heic'
  return null
}

/** File extension used for the stored original — matches sharp/libvips' own format ids closely enough for a storage key. */
export function extensionForMimeType(mimeType: AllowedImageMimeType): string {
  return mimeType.slice('image/'.length)
}
