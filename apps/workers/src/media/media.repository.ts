import type { Database } from '@x/db'
import { media } from '@x/db'
import { MEDIA_STATUS, type MediaVariant } from '@x/utils'
import { eq } from 'drizzle-orm'

export type MediaRow = typeof media.$inferSelect

export type MediaRepository = ReturnType<typeof createMediaRepository>

/**
 * The worker's own data access to the `media` table — a separate
 * implementation from apps/api's media.repository.ts, same as
 * apps/workers/src/fanout and counters each own their repository despite
 * touching tables apps/api also touches.
 */
export function createMediaRepository(db: Database) {
  return {
    async findMediaById(id: bigint): Promise<MediaRow | null> {
      const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1)
      return row ?? null
    },

    async markReady(
      id: bigint,
      result: {
        width: number
        height: number
        /** For kind:'gif'/'video' this is computed from the extracted poster frame, not a raw source pixel — SPECS.md §9.2's blurhash step reads as applying to the whole pipeline, not just images. */
        blurhash: string
        variants: MediaVariant[]
        /** null for kind:'image' — stills have no duration. */
        durationMs?: number | null
      },
    ): Promise<void> {
      await db
        .update(media)
        .set({
          status: MEDIA_STATUS.READY,
          width: result.width,
          height: result.height,
          blurhash: result.blurhash,
          variants: result.variants,
          durationMs: result.durationMs ?? null,
        })
        .where(eq(media.id, id))
    },

    async markFailed(id: bigint): Promise<void> {
      await db.update(media).set({ status: MEDIA_STATUS.FAILED }).where(eq(media.id, id))
    },
  }
}
