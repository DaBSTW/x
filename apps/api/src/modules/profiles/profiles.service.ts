import type { UpdateUserInput, UserProfile } from '@x/contracts'
import { NotFoundError, ValidationError, buildPublicUrl, pickPrimaryVariant } from '@x/utils'
import type { ProfilePatch, ProfileRow, ProfilesRepository } from './profiles.repository.js'

export type MediaUrlConfig = {
  bucket: string
  publicUrlBase: string
}

// Same reasoning as posts.service.ts's DEFAULT_MEDIA_URL_CONFIG: matches
// .env.example's defaults, so existing tests that never touch avatar/banner
// media don't need updating for a config they'll never read from.
const DEFAULT_MEDIA_URL_CONFIG: MediaUrlConfig = {
  bucket: 'x-media',
  publicUrlBase: 'http://localhost:9000',
}

export type ProfilesService = ReturnType<typeof createProfilesService>

export function createProfilesService(
  repository: ProfilesRepository,
  mediaUrlConfig: MediaUrlConfig = DEFAULT_MEDIA_URL_CONFIG,
) {
  async function getByUsername(usernameLower: string): Promise<UserProfile> {
    const row = await repository.findProfileByUsername(usernameLower)
    if (!row) throw new NotFoundError('user', usernameLower)
    return toProfileDto(row)
  }

  async function getById(userId: bigint): Promise<UserProfile> {
    const row = await repository.findProfileById(userId)
    if (!row) throw new NotFoundError('user', userId.toString())
    return toProfileDto(row)
  }

  /** avatarMediaId/bannerMediaId resolve to a real, owned, ready image's URL here — the same idea as posts.service.ts's toPostMediaItem, just for a single URL instead of a full media resource. */
  async function resolveOwnedImageUrl(userId: bigint, mediaId: bigint): Promise<string> {
    const row = await repository.findReadyImageMedia(mediaId, userId)
    if (!row) {
      throw new ValidationError(
        'media attachment is invalid, not owned, not ready, or not an image',
      )
    }
    const variants = row.variants.map((variant) => ({
      ...variant,
      url: buildPublicUrl(mediaUrlConfig.publicUrlBase, mediaUrlConfig.bucket, variant.key),
    }))
    const primary = pickPrimaryVariant(variants)
    return (
      primary?.url ??
      buildPublicUrl(mediaUrlConfig.publicUrlBase, mediaUrlConfig.bucket, row.storageKey)
    )
  }

  async function updateMe(userId: bigint, input: UpdateUserInput): Promise<UserProfile> {
    const { avatarMediaId, bannerMediaId, ...rest } = input
    const patch: ProfilePatch = { ...rest }
    if (avatarMediaId !== undefined) {
      patch.avatarUrl = await resolveOwnedImageUrl(userId, BigInt(avatarMediaId))
    }
    if (bannerMediaId !== undefined) {
      patch.bannerUrl = await resolveOwnedImageUrl(userId, BigInt(bannerMediaId))
    }
    await repository.updateProfile(userId, patch)
    return getById(userId)
  }

  return { getByUsername, getById, updateMe }
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
