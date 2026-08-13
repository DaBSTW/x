import type { Database } from '@x/db'
import { media, users } from '@x/db'
import { MEDIA_STATUS } from '@x/utils'
import { and, eq, inArray } from 'drizzle-orm'

export type MediaRow = typeof media.$inferSelect

export type NewMediaRow = {
  id: bigint
  ownerId: bigint
  storageKey: string
  mimeType: string
  sizeBytes: bigint
  kind: 'image' | 'gif' | 'video'
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

    /** ROADMAP.md 2.7's video duration exception (140 s / 2 h para verificados) — a fresh read, not something carried in the access token: verification status can change between when a token was issued and when a video is finalized. */
    async findOwnerIsVerified(ownerId: bigint): Promise<boolean> {
      const [row] = await db
        .select({ isVerified: users.isVerified })
        .from(users)
        .where(eq(users.id, ownerId))
        .limit(1)
      return row?.isVerified ?? false
    },
  }
}
