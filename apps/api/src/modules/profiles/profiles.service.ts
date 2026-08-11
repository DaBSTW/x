import type { UserProfile } from '@x/contracts'
import { NotFoundError } from '@x/utils'
import type { ProfilePatch, ProfileRow, ProfilesRepository } from './profiles.repository.js'

export type ProfilesService = ReturnType<typeof createProfilesService>

export function createProfilesService(repository: ProfilesRepository) {
  async function getByUsername(usernameLower: string): Promise<UserProfile> {
    const row = await repository.findProfileByUsername(usernameLower)
    if (!row) throw new NotFoundError('user', usernameLower)
    return toProfileDto(row)
  }

  async function updateMe(userId: bigint, patch: ProfilePatch): Promise<UserProfile> {
    await repository.updateProfile(userId, patch)
    const row = await repository.findProfileById(userId)
    if (!row) throw new NotFoundError('user', userId.toString())
    return toProfileDto(row)
  }

  return { getByUsername, updateMe }
}

function toProfileDto(row: ProfileRow): UserProfile {
  return {
    id: row.id.toString(),
    username: row.username,
    displayName: row.displayName,
    bio: row.bio,
    location: row.location,
    websiteUrl: row.websiteUrl,
    avatarUrl: row.avatarUrl,
    bannerUrl: row.bannerUrl,
    isProtected: row.isProtected,
    isVerified: row.isVerified,
    createdAt: row.createdAt.toISOString(),
    counters: {
      followers: row.followersCount,
      following: row.followingCount,
      posts: row.postsCount,
    },
  }
}
