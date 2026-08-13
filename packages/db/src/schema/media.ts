import { sql } from 'drizzle-orm'
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users.js'

export const mediaKind = pgEnum('media_kind', ['image', 'gif', 'video'])

// Structurally matches @x/utils' own MediaVariant (independently declared,
// same reason as elsewhere in this file: @x/db doesn't otherwise need to
// depend on @x/utils' full media surface just for one shared shape).
export type MediaVariantRow = {
  width: number
  height: number
  format: 'webp' | 'avif' | 'mp4' | 'poster' | 'hls' | 'hls-master'
  key: string
  /** Only set for format:'hls' (one bitrate rendition). */
  bandwidthBps?: number
}

// `postId` has no FK — same reason likes/bookmarks don't have one (see
// interactions.ts): `posts` is partitioned with primary key (id, created_at),
// and a partitioned table's non-partition-key column can't be an FK target.
export const media = pgTable(
  'media',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    ownerId: bigint('owner_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id),
    postId: bigint('post_id', { mode: 'bigint' }),
    kind: mediaKind('kind').notNull().default('image'),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    blurhash: text('blurhash'),
    altText: varchar('alt_text', { length: 1000 }),
    variants: jsonb('variants').notNull().default(sql`'[]'::jsonb`).$type<MediaVariantRow[]>(),
    // 0 pending, 1 ready, 2 failed — @x/utils' MEDIA_STATUS.
    status: smallint('status').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_media_post').on(table.postId).where(sql`${table.postId} is not null`)],
)

export type Media = typeof media.$inferSelect
export type NewMedia = typeof media.$inferInsert

/**
 * SPECS.md §9.2's "hash contra base de contenido conocido (PhotoDNA/CSAM)"
 * — PhotoDNA itself is a proprietary Microsoft service this repo has no
 * vendor relationship with and can't honestly claim to integrate against;
 * what's built here instead is a real, working first line of defense that
 * *is* a legitimate, widely-used technique on its own (NCMEC and others do
 * distribute exact-hash lists) — SHA-256 exact-match against a maintained
 * table of known-bad hashes, documented plainly as a simplification of
 * PhotoDNA's own perceptual hashing (which tolerates cropping/recompression;
 * exact-match doesn't), not a silent stand-in for it. Postgres, not Redis,
 * on purpose: this list is a security control, not cache-warm-able derived
 * state — losing it to a Redis restart would be a real regression, not a
 * cheap-to-rebuild inconvenience.
 */
export const knownContentHashes = pgTable('known_content_hashes', {
  sha256: varchar('sha256', { length: 64 }).primaryKey(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason'),
})

export type KnownContentHash = typeof knownContentHashes.$inferSelect
export type NewKnownContentHash = typeof knownContentHashes.$inferInsert
