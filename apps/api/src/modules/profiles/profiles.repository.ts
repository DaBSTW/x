import type { Database, MediaVariantRow } from '@x/db'
import { media, userCounters, users } from '@x/db'
import { MEDIA_STATUS } from '@x/utils'
import { and, eq } from 'drizzle-orm'

export type ProfileRow = {
  id: bigint
  username: string
  displayName: string
  bio: string | null
  location: string | null
  websiteUrl: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  isProtected: boolean
  isVerified: boolean
  createdAt: Date
  followersCount: number
  followingCount: number
  postsCount: number
}

export type ProfilePatch = {
  displayName?: string | undefined
  bio?: string | undefined
  location?: string | undefined
  websiteUrl?: string | undefined
  isProtected?: boolean | undefined
  avatarUrl?: string | undefined
  bannerUrl?: string | undefined
  dmPrivacy?: number | undefined
}

export type OwnedMediaRow = {
  id: bigint
  storageKey: string
  variants: MediaVariantRow[]
}

const PROFILE_COLUMNS = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  bio: users.bio,
  location: users.location,
  websiteUrl: users.websiteUrl,
  avatarUrl: users.avatarUrl,
  bannerUrl: users.bannerUrl,
  isProtected: users.isProtected,
  isVerified: users.isVerified,
  createdAt: users.createdAt,
  followersCount: userCounters.followersCount,
  followingCount: userCounters.followingCount,
  postsCount: userCounters.postsCount,
} as const

export type ProfilesRepository = ReturnType<typeof createProfilesRepository>

export function createProfilesRepository(db: Database) {
  return {
    async findProfileByUsername(usernameLower: string): Promise<ProfileRow | null> {
      const [row] = await db
        .select(PROFILE_COLUMNS)
        .from(users)
        .innerJoin(userCounters, eq(userCounters.userId, users.id))
        .where(eq(users.usernameLower, usernameLower))
        .limit(1)
      return row ?? null
    },

    async findProfileById(id: bigint): Promise<ProfileRow | null> {
      const [row] = await db
        .select(PROFILE_COLUMNS)
        .from(users)
        .innerJoin(userCounters, eq(userCounters.userId, users.id))
        .where(eq(users.id, id))
        .limit(1)
      return row ?? null
    },

    async updateProfile(id: bigint, patch: ProfilePatch): Promise<void> {
      if (Object.keys(patch).length === 0) return
      await db
        .update(users)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(users.id, id))
    },

    /** Backs avatarMediaId/bannerMediaId (ROADMAP.md 1.6) — only a row the caller owns, that finished processing, and that is actually an image can become an avatar or banner. */
    async findReadyImageMedia(mediaId: bigint, ownerId: bigint): Promise<OwnedMediaRow | null> {
      const [row] = await db
        .select({ id: media.id, storageKey: media.storageKey, variants: media.variants })
        .from(media)
        .where(
          and(
            eq(media.id, mediaId),
            eq(media.ownerId, ownerId),
            eq(media.status, MEDIA_STATUS.READY),
            eq(media.kind, 'image'),
          ),
        )
        .limit(1)
      return row ?? null
    },
  }
}
