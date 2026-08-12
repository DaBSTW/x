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

// Matches conversations.service.ts's own DM_PRIVACY_CODES — kept as two
// separate small maps rather than a shared import, same reasoning
// posts.service.ts's REPLY_POLICY_CODES never got extracted either.
const DM_PRIVACY_CODES: Record<NonNullable<UpdateUserInput['dmPrivacy']>, number> = {
  everyone: 0,
  following: 1,
}

/**
 * Backs `viewer.following`/`viewer.requested` on `GET /users/:username`
 * (ROADMAP.md 1.6, deferred from 1.4 for the same "needs optional auth"
 * reason `GET /posts/:id` was — posts.service.ts's own ViewerStateLookup
 * closed that gap first). Two lookups, not one: a protected account
 * (ROADMAP.md 2.6) can have a *pending request* without an actual follow,
 * which <FollowButton>'s third state ("Solicitud enviada") depends on
 * telling apart from either extreme.
 */
export type FollowStateLookup = {
  isFollowing(followerId: bigint, followeeId: bigint): Promise<boolean>
  hasPendingFollowRequest(requesterId: bigint, targetId: bigint): Promise<boolean>
}

export type ProfilesService = ReturnType<typeof createProfilesService>

export function createProfilesService(
  repository: ProfilesRepository,
  mediaUrlConfig: MediaUrlConfig = DEFAULT_MEDIA_URL_CONFIG,
  // Optional, same posture as every other lookup dependency in this
  // codebase (posts.service.ts's blockLookup/protectionLookup/etc.): unset,
  // no viewerId, or viewerId === the profile's own id (nothing to ask —
  // nobody follows themselves) all leave `viewer` absent from the response.
  followState?: FollowStateLookup,
) {
  async function withViewerFollowState(
    profile: UserProfile,
    viewerId?: bigint,
  ): Promise<UserProfile> {
    const targetId = BigInt(profile.id)
    if (!followState || viewerId === undefined || viewerId === targetId) return profile
    const [following, requested] = await Promise.all([
      followState.isFollowing(viewerId, targetId),
      followState.hasPendingFollowRequest(viewerId, targetId),
    ])
    return { ...profile, viewer: { following, requested } }
  }

  async function getByUsername(usernameLower: string, viewerId?: bigint): Promise<UserProfile> {
    const row = await repository.findProfileByUsername(usernameLower)
    if (!row) throw new NotFoundError('user', usernameLower)
    return withViewerFollowState(toProfileDto(row), viewerId)
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
    const { avatarMediaId, bannerMediaId, dmPrivacy, ...rest } = input
    const patch: ProfilePatch = { ...rest }
    if (avatarMediaId !== undefined) {
      patch.avatarUrl = await resolveOwnedImageUrl(userId, BigInt(avatarMediaId))
    }
    if (bannerMediaId !== undefined) {
      patch.bannerUrl = await resolveOwnedImageUrl(userId, BigInt(bannerMediaId))
    }
    if (dmPrivacy !== undefined) {
      patch.dmPrivacy = DM_PRIVACY_CODES[dmPrivacy]
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
