// Shared between apps/api (producer: upload-url + finalize) and apps/workers
// (consumer: transcoding), same reason queues.ts and notifications.ts are
// shared — SPECS.md §3, ROADMAP.md 1.5/2.7.

export const MEDIA_PROCESSING_QUEUE_NAME = 'media-processing'

export type MediaProcessingJobData = {
  mediaId: string
}

// 0 pending, 1 ready, 2 failed — mirrors SPECS.md §4.2's `media.status` column.
export const MEDIA_STATUS = { PENDING: 0, READY: 1, FAILED: 2 } as const
export type MediaStatus = (typeof MEDIA_STATUS)[keyof typeof MEDIA_STATUS]

// Independently declared from @x/db's own `mediaKind` pgEnum (same reason
// MediaVariant below duplicates schema/media.ts's MediaVariantRow instead of
// importing it) — a plain string union is all callers on this side of the
// process boundary need.
export type MediaKind = 'image' | 'gif' | 'video'

export const MEDIA_LIMITS = {
  // SPECS.md §9.2's image row: 5 MB, 8192×8192. The same dimension cap also
  // doubles as the decompression-bomb pixel budget passed to sharp's
  // `limitInputPixels` — libvips refuses to decode past it, so a tiny file
  // that claims an enormous canvas is rejected before it can exhaust memory.
  MAX_SIZE_BYTES: 5 * 1024 * 1024,
  MAX_DIMENSION: 8192,
  MAX_ATTACHMENTS_PER_POST: 4,
  // SPECS.md §9.2's GIF row.
  MAX_GIF_SIZE_BYTES: 15 * 1024 * 1024,
  // SPECS.md §9.2's video row: 512 MB regardless of verification status —
  // only the *duration* limit relaxes for verified accounts, read literally
  // from where SPECS.md places the parenthetical ("140 s (2 h para
  // verificados)", directly after the duration figure, not the size one).
  MAX_VIDEO_SIZE_BYTES: 512 * 1024 * 1024,
  MAX_VIDEO_DURATION_SECONDS: 140,
  MAX_VIDEO_DURATION_SECONDS_VERIFIED: 2 * 60 * 60,
  // ROADMAP.md 2.7: "Worker ffmpeg aislado con límites de CPU/memoria y
  // timeout de 10 min" — ffmpeg-runner.ts's hard wall-clock kill.
  FFMPEG_TIMEOUT_MS: 10 * 60 * 1000,
  // ffmpeg-runner.ts's prlimit(1) ceiling passed to every spawned ffmpeg —
  // generous enough for a 1080p H.264 encode (libx264 buffers a handful of
  // frames, never the whole source) while still bounding a pathological
  // input (an absurd resolution/filter graph) from taking the whole worker
  // process down with it.
  FFMPEG_MAX_MEMORY_BYTES: 1536 * 1024 * 1024,
  FFMPEG_MAX_CPU_SECONDS: 600,
} as const

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
] as const
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number]

export const ALLOWED_GIF_MIME_TYPES = ['image/gif'] as const
export type AllowedGifMimeType = (typeof ALLOWED_GIF_MIME_TYPES)[number]

// MOV's real MIME type is video/quicktime — SPECS.md §9.2 names the
// container ("MOV"), not a MIME string, so this is the standard one real
// QuickTime/ffmpeg-produced files declare.
export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const
export type AllowedVideoMimeType = (typeof ALLOWED_VIDEO_MIME_TYPES)[number]

export type AllowedMediaMimeType = AllowedImageMimeType | AllowedGifMimeType | AllowedVideoMimeType

/** `POST /media/upload-url`'s `mimeType` decides `kind` server-side — a client never gets to declare it directly. */
export function mediaKindForMimeType(mimeType: AllowedMediaMimeType): MediaKind {
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType.startsWith('video/')) return 'video'
  return 'image'
}

// "orig" (SPECS.md §9.2) isn't a fixed width — it's the source image's own
// width, capped at MAX_DIMENSION. Callers add it themselves.
export const MEDIA_VARIANT_WIDTHS = [340, 600, 1200] as const

// What media.processor.ts's own image path actually loops over — a strict
// subset of MEDIA_VARIANT_FORMATS below, kept separate so that loop can't
// silently start iterating GIF/video formats too the next time this union
// grows (exactly what widening MEDIA_VARIANT_FORMATS in this same
// checkpoint would otherwise have done).
export const IMAGE_VARIANT_FORMATS = ['webp', 'avif'] as const
export type ImageVariantFormat = (typeof IMAGE_VARIANT_FORMATS)[number]

export const MEDIA_VARIANT_FORMATS = [
  ...IMAGE_VARIANT_FORMATS,
  // GIF → MP4 (ROADMAP.md 2.7) and its extracted poster frame.
  'mp4',
  'poster',
  // One entry per bitrate rendition, plus the master playlist a player
  // actually loads (SPECS.md §9.2's HLS multi-bitrate output).
  'hls',
  'hls-master',
] as const
export type MediaVariantFormat = (typeof MEDIA_VARIANT_FORMATS)[number]

export type MediaVariant = {
  width: number
  height: number
  format: MediaVariantFormat
  key: string
  /** Only set for format:'hls' (one bitrate rendition) — its target encode bitrate, so a player or ops tooling can tell renditions apart without re-parsing the playlist. */
  bandwidthBps?: number
}

export function mediaOriginalKey(mediaId: string, extension: string): string {
  return `media/${mediaId}/original.${extension}`
}

export function mediaVariantKey(
  mediaId: string,
  width: number,
  format: ImageVariantFormat,
): string {
  return `media/${mediaId}/${width}.${format}`
}

/** GIF → MP4's own output — one file, no width tiers (SPECS.md §9.2 doesn't ask for a bitrate ladder here, only for video). */
export function mediaGifMp4Key(mediaId: string): string {
  return `media/${mediaId}/gif.mp4`
}

/** The poster frame extracted for a GIF (SPECS.md §9.2) or a video (this checkpoint's own addition — see ROADMAP.md 2.7's note on why). */
export function mediaPosterKey(mediaId: string): string {
  return `media/${mediaId}/poster.webp`
}

/** The single playlist a player actually requests — lists every rendition below by relative path, letting the player itself switch bitrate. */
export function mediaHlsMasterKey(mediaId: string): string {
  return `media/${mediaId}/hls/master.m3u8`
}

export function mediaHlsRenditionPlaylistKey(mediaId: string, heightLabel: number): string {
  return `media/${mediaId}/hls/${heightLabel}p/playlist.m3u8`
}

/** Segments for one rendition live under this prefix — never enumerated individually in the DB, same way a real HLS deployment works: the rendition's own playlist is the index, not Postgres. */
export function mediaHlsSegmentKeyPrefix(mediaId: string, heightLabel: number): string {
  return `media/${mediaId}/hls/${heightLabel}p/`
}

export type HlsRenditionSpec = {
  height: number
  videoBitrateKbps: number
  audioBitrateKbps: number
}

// SPECS.md §9.2: "HLS multi-bitrate (240p–1080p), H.264 + AAC" — the ladder
// of heights is specified, the actual bitrates per rung aren't (same kind of
// gap already documented for search's function_score weights in 2.3). These
// are standard, widely-used values for these exact resolutions (comparable
// to public ladders from YouTube/Twitch/Mux), not an arbitrary guess.
export const HLS_RENDITION_LADDER: HlsRenditionSpec[] = [
  { height: 240, videoBitrateKbps: 400, audioBitrateKbps: 64 },
  { height: 360, videoBitrateKbps: 800, audioBitrateKbps: 96 },
  { height: 480, videoBitrateKbps: 1400, audioBitrateKbps: 128 },
  { height: 720, videoBitrateKbps: 2800, audioBitrateKbps: 128 },
  { height: 1080, videoBitrateKbps: 5000, audioBitrateKbps: 192 },
]

/**
 * The variant a caller gets when it just wants "a reasonable image URL", not
 * a specific size — the widest WebP variant (every modern reader decodes
 * WebP; AVIF is the smaller-but-narrower-supported alternative offered
 * alongside it, not instead of it). Generic so it works on both the raw
 * storage-key-bearing rows and a URL-bearing DTO shape. Images only — GIF/
 * video use the format-specific pickers below instead, since "widest webp"
 * doesn't mean anything for either.
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

/** The MP4 a GIF was transcoded into (ROADMAP.md 2.7) — what a `kind:'gif'` media's own `url` resolves to. */
export function pickMp4Variant<V extends { format: MediaVariantFormat }>(
  variants: V[],
): V | undefined {
  return variants.find((variant) => variant.format === 'mp4')
}

/** The one playlist a `kind:'video'` media's own `url` resolves to — never a specific rendition, always the master. */
export function pickHlsMasterVariant<V extends { format: MediaVariantFormat }>(
  variants: V[],
): V | undefined {
  return variants.find((variant) => variant.format === 'hls-master')
}

/** The extracted poster frame, for both `kind:'gif'` and `kind:'video'`. */
export function pickPosterVariant<V extends { format: MediaVariantFormat }>(
  variants: V[],
): V | undefined {
  return variants.find((variant) => variant.format === 'poster')
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

/** GIF87a/GIF89a — https://www.w3.org/Graphics/GIF/spec-gif89a.txt's own header signature, same "never trust Content-Type" posture as detectImageMimeType. */
export function detectGifMimeType(buffer: Buffer): AllowedGifMimeType | null {
  if (buffer.length < 6) return null
  const header = buffer.toString('ascii', 0, 6)
  return header === 'GIF87a' || header === 'GIF89a' ? 'image/gif' : null
}

/**
 * WebM is EBML (fixed 4-byte magic). MP4/MOV are both ISO-BMFF — same
 * `ftyp`-box shape detectImageMimeType already sniffs for AVIF/HEIC, but
 * real-world encoders emit dozens of valid major-brand strings for MP4
 * (`isom`, `mp42`, `avc1`, `M4V `, …), so unlike the fixed AVIF/HEIC brand
 * lists this doesn't allowlist-match one: any `ftyp` box is classified as
 * MOV only for the one QuickTime-specific brand, MP4 otherwise.
 */
export function detectVideoMimeType(buffer: Buffer): AllowedVideoMimeType | null {
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return 'video/webm'
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    return buffer.toString('ascii', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4'
  }
  return null
}

/** File extension used for the stored original — matches sharp/libvips' or ffmpeg's own format ids closely enough for a storage key. */
export function extensionForMimeType(mimeType: AllowedMediaMimeType): string {
  if (mimeType === 'video/quicktime') return 'mov'
  return mimeType.slice(mimeType.indexOf('/') + 1)
}
