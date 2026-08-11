import type { Database } from '@x/db'
import { userCounters, users } from '@x/db'
import { eq } from 'drizzle-orm'

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
  }
}
