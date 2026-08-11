import type { Database } from '@x/db'
import { media } from '@x/db'
import { MEDIA_STATUS } from '@x/utils'
import { and, eq, inArray } from 'drizzle-orm'

export type MediaRow = typeof media.$inferSelect

export type NewMediaRow = {
  id: bigint
  ownerId: bigint
  storageKey: string
  mimeType: string
  sizeBytes: bigint
}

export type MediaRepository = ReturnType<typeof createMediaRepository>

export function createMediaRepository(db: Database) {
  return {
    async insertMedia(row: NewMediaRow): Promise<void> {
      await db.insert(media).values(row)
    },

    async findMediaById(id: bigint): Promise<MediaRow | null> {
      const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1)
      return row ?? null
    },

    /** Finalize failed validation (bad magic bytes, oversize, bad dimensions) — a terminal state, no job was ever queued. */
    async markFailed(id: bigint): Promise<void> {
      await db.update(media).set({ status: MEDIA_STATUS.FAILED }).where(eq(media.id, id))
    },

    async updateAltText(id: bigint, ownerId: bigint, altText: string): Promise<boolean> {
      const rows = await db
        .update(media)
        .set({ altText })
        .where(and(eq(media.id, id), eq(media.ownerId, ownerId)))
        .returning({ id: media.id })
      return rows.length > 0
    },

    /** Batch hydration for post reads, mirroring posts.repository.ts's findEntitiesForPosts. */
    async findMediaForPosts(postIds: bigint[]): Promise<MediaRow[]> {
      if (postIds.length === 0) return []
      return db.select().from(media).where(inArray(media.postId, postIds))
    },
  }
}
