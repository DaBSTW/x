import type { UpdateUserInput } from '@x/contracts'
import { generateId } from '@x/utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  OwnedMediaRow,
  ProfilePatch,
  ProfileRow,
  ProfilesRepository,
} from './profiles.repository.js'
import { createProfilesService } from './profiles.service.js'

function makeRow(overrides: Partial<ProfileRow> & Pick<ProfileRow, 'id'>): ProfileRow {
  return {
    username: 'ana',
    displayName: 'Ana',
    bio: null,
    location: null,
    websiteUrl: null,
    avatarUrl: null,
    bannerUrl: null,
    isProtected: false,
    isVerified: false,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    ...overrides,
  }
}

function createFakeRepository() {
  const rowsById = new Map<bigint, ProfileRow>()
  // Keyed by `${ownerId}:${mediaId}` — enough to fake "owned, ready, image"
  // without modeling the whole media table.
  const ownedMediaByKey = new Map<string, OwnedMediaRow>()

  const repository: ProfilesRepository = {
    async findProfileByUsername(usernameLower) {
      for (const row of rowsById.values()) {
        if (row.username.toLowerCase() === usernameLower) return row
      }
      return null
    },
    async findProfileById(id) {
      return rowsById.get(id) ?? null
    },
    async updateProfile(id, patch) {
      const row = rowsById.get(id)
      if (!row) return
      // Only overwrite keys the patch actually set — matches the real
      // repository's UPDATE...SET, and keeps this typed under
      // exactOptionalPropertyTypes (patch fields allow `undefined`).
      const next = { ...row }
      for (const key of Object.keys(patch) as Array<keyof ProfilePatch>) {
        const value = patch[key]
        if (value !== undefined) Object.assign(next, { [key]: value })
      }
      rowsById.set(id, next)
    },
    async findReadyImageMedia(mediaId, ownerId) {
      return ownedMediaByKey.get(`${ownerId}:${mediaId}`) ?? null
    },
  }

  return { repository, rowsById, ownedMediaByKey }
}

// Mirrors posts.service.test.ts's createFakeFollowLookup/createFakeBlockLookup
// — two small `${a}:${b}` sets are enough to fake FollowStateLookup's two methods.
function createFakeFollowStateLookup() {
  const following = new Set<string>()
  const requested = new Set<string>()
  return {
    followState: {
      async isFollowing(followerId: bigint, followeeId: bigint) {
        return following.has(`${followerId}:${followeeId}`)
      },
      async hasPendingFollowRequest(requesterId: bigint, targetId: bigint) {
        return requested.has(`${requesterId}:${targetId}`)
      },
    },
    follow(followerId: bigint, followeeId: bigint) {
      following.add(`${followerId}:${followeeId}`)
    },
    request(requesterId: bigint, targetId: bigint) {
      requested.add(`${requesterId}:${targetId}`)
    },
  }
}

describe('createProfilesService', () => {
  let repository: ProfilesRepository
  let rowsById: Map<bigint, ProfileRow>
  let ownedMediaByKey: Map<string, OwnedMediaRow>
  let userId: bigint

  beforeEach(() => {
    const fake = createFakeRepository()
    repository = fake.repository
    rowsById = fake.rowsById
    ownedMediaByKey = fake.ownedMediaByKey
    userId = generateId()
    rowsById.set(
      userId,
      makeRow({ id: userId, followersCount: 3, followingCount: 5, postsCount: 2 }),
    )
  })

  describe('getByUsername', () => {
    it('maps a row to the contract shape, including counters', async () => {
      const service = createProfilesService(repository)

      const profile = await service.getByUsername('ana')

      expect(profile.id).toBe(userId.toString())
      expect(profile.counters).toEqual({ followers: 3, following: 5, posts: 2 })
    })

    it('throws NotFoundError for an unknown username', async () => {
      const service = createProfilesService(repository)
      await expect(service.getByUsername('ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    // ROADMAP.md 1.6/1.4: viewer.following/requested.
    it('omits viewer when there is no viewerId (anonymous)', async () => {
      const { followState } = createFakeFollowStateLookup()
      const service = createProfilesService(repository, undefined, followState)
      const profile = await service.getByUsername('ana')
      expect(profile.viewer).toBeUndefined()
    })

    it('omits viewer when no followState dependency is wired up', async () => {
      const service = createProfilesService(repository)
      const profile = await service.getByUsername('ana', generateId())
      expect(profile.viewer).toBeUndefined()
    })

    it('omits viewer when the viewer is looking at their own profile', async () => {
      const { followState } = createFakeFollowStateLookup()
      const service = createProfilesService(repository, undefined, followState)
      const profile = await service.getByUsername('ana', userId)
      expect(profile.viewer).toBeUndefined()
    })

    it('reports following: true for a profile the viewer already follows', async () => {
      const { followState, follow } = createFakeFollowStateLookup()
      const service = createProfilesService(repository, undefined, followState)
      const viewer = generateId()
      follow(viewer, userId)

      const profile = await service.getByUsername('ana', viewer)
      expect(profile.viewer).toEqual({ following: true, requested: false })
    })

    it('reports requested: true for a pending request against a protected account, without following', async () => {
      const { followState, request } = createFakeFollowStateLookup()
      const service = createProfilesService(repository, undefined, followState)
      const viewer = generateId()
      request(viewer, userId)

      const profile = await service.getByUsername('ana', viewer)
      expect(profile.viewer).toEqual({ following: false, requested: true })
    })

    it('reports both false for a viewer with no relationship to the profile', async () => {
      const { followState } = createFakeFollowStateLookup()
      const service = createProfilesService(repository, undefined, followState)

      const profile = await service.getByUsername('ana', generateId())
      expect(profile.viewer).toEqual({ following: false, requested: false })
    })
  })

  describe('getById', () => {
    it('maps a row to the contract shape', async () => {
      const service = createProfilesService(repository)
      const profile = await service.getById(userId)
      expect(profile.username).toBe('ana')
    })

    it('throws NotFoundError for an unknown id', async () => {
      const service = createProfilesService(repository)
      await expect(service.getById(999999999999999999n)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })
  })

  describe('updateMe', () => {
    it('applies a partial patch and returns the updated profile', async () => {
      const service = createProfilesService(repository)
      const patch: UpdateUserInput = { bio: 'nueva bio', location: 'Madrid' }

      const profile = await service.updateMe(userId, patch)

      expect(profile.bio).toBe('nueva bio')
      expect(profile.location).toBe('Madrid')
      expect(profile.displayName).toBe('Ana') // untouched
    })

    it('is a no-op write for an empty patch', async () => {
      const service = createProfilesService(repository)
      const before = rowsById.get(userId)

      const profile = await service.updateMe(userId, {})

      expect(rowsById.get(userId)).toEqual(before)
      expect(profile.displayName).toBe('Ana')
    })

    it('converts dmPrivacy to the stored 0/1 code (ROADMAP.md 2.5)', async () => {
      const service = createProfilesService(repository)

      await service.updateMe(userId, { dmPrivacy: 'following' })

      expect(rowsById.get(userId)).toMatchObject({ dmPrivacy: 1 })
    })

    it('resolves avatarMediaId to the owned image’s URL', async () => {
      const service = createProfilesService(repository)
      const mediaId = generateId()
      ownedMediaByKey.set(`${userId}:${mediaId}`, {
        id: mediaId,
        storageKey: `media/${mediaId}/original.webp`,
        variants: [{ width: 400, height: 400, format: 'webp', key: `media/${mediaId}/400.webp` }],
      })

      const profile = await service.updateMe(userId, { avatarMediaId: mediaId.toString() })

      expect(profile.avatarUrl).toContain('400.webp')
    })

    it('falls back to the original storage key when the image has no variants yet', async () => {
      const service = createProfilesService(repository)
      const mediaId = generateId()
      ownedMediaByKey.set(`${userId}:${mediaId}`, {
        id: mediaId,
        storageKey: `media/${mediaId}/original.webp`,
        variants: [],
      })

      const profile = await service.updateMe(userId, { bannerMediaId: mediaId.toString() })

      expect(profile.bannerUrl).toContain('original.webp')
    })

    it('rejects a bannerMediaId that does not belong to the caller', async () => {
      const service = createProfilesService(repository)
      const foreignMediaId = generateId()
      ownedMediaByKey.set(`${generateId()}:${foreignMediaId}`, {
        id: foreignMediaId,
        storageKey: `media/${foreignMediaId}/original.webp`,
        variants: [],
      })

      await expect(
        service.updateMe(userId, { bannerMediaId: foreignMediaId.toString() }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })
  })
})
