import { z } from 'zod'
import { snowflakeIdSchema } from './common.js'

export const mediaKindSchema = z.enum(['image', 'gif', 'video'])

// Matches @x/utils' ALLOWED_IMAGE_MIME_TYPES ∪ ALLOWED_GIF_MIME_TYPES ∪
// ALLOWED_VIDEO_MIME_TYPES (ROADMAP.md 2.7) — `kind` itself is never part of
// the request, media.service.ts derives it server-side from `mimeType`
// (mediaKindForMimeType), the same "the server decides, the client doesn't
// declare" posture magic-byte sniffing already applies at finalize time.
export const uploadMediaRequestSchema = z.object({
  mimeType: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/heic',
    'image/gif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
  ]),
})
export type UploadMediaRequest = z.infer<typeof uploadMediaRequestSchema>

export const uploadMediaResponseSchema = z.object({
  data: z.object({
    mediaId: snowflakeIdSchema,
    uploadUrl: z.string().url(),
  }),
})

export const mediaStatusSchema = z.enum(['pending', 'ready', 'failed'])
export type MediaStatusDto = z.infer<typeof mediaStatusSchema>

export const finalizeMediaResponseSchema = z.object({
  data: z.object({ id: snowflakeIdSchema, status: mediaStatusSchema }),
})

export const mediaVariantSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  format: z.enum(['webp', 'avif', 'mp4', 'poster', 'hls', 'hls-master']),
  url: z.string().url(),
})
export type MediaVariantDto = z.infer<typeof mediaVariantSchema>

// The full resource — GET/PATCH /media/:id. Includes `status` and the raw
// `variants` list, since a caller polling an in-flight upload needs both.
// `posterUrl`/`durationMs` are null for `kind:'image'` (there's no separate
// poster frame or duration for a still image) and set once a `kind:'gif'`/
// `kind:'video'` finishes processing — `url` itself is the MP4 for a GIF or
// the HLS master playlist for a video (never a specific rendition), same
// "one field, the primary thing a client renders" contract `url` already
// has for images.
export const mediaSchema = z.object({
  id: snowflakeIdSchema,
  kind: mediaKindSchema,
  status: mediaStatusSchema,
  url: z.string().url().nullable(),
  posterUrl: z.string().url().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable(),
  blurhash: z.string().nullable(),
  altText: z.string().nullable(),
  variants: z.array(mediaVariantSchema),
})
export type MediaItem = z.infer<typeof mediaSchema>

export const mediaResponseSchema = z.object({ data: mediaSchema })

export const updateMediaSchema = z.object({
  altText: z.string().max(1000),
})
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>

// The shape embedded in a Post (SPECS.md §5.4's example) — lighter than
// mediaSchema: by the time media is attached to a post it's always ready
// (posts.service only accepts `status = ready` media ids), so there's no
// `status` or `variants` list to expose here, just what a client renders.
export const postMediaItemSchema = z.object({
  id: snowflakeIdSchema,
  kind: mediaKindSchema,
  url: z.string().url(),
  posterUrl: z.string().url().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable(),
  blurhash: z.string().nullable(),
  altText: z.string().nullable(),
})
export type PostMediaItem = z.infer<typeof postMediaItemSchema>
