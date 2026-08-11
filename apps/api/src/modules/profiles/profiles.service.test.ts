import { generateId } from '@x/utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ProfilePatch, ProfileRow, ProfilesRepository } from './profiles.repository.js'
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
  }

  return { repository, rowsById }
}

describe('createProfilesService', () => {
  let repository: ProfilesRepository
  let rowsById: Map<bigint, ProfileRow>
  let userId: bigint

  beforeEach(() => {
    const fake = createFakeRepository()
    repository = fake.repository
    rowsById = fake.rowsById
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
      const patch: ProfilePatch = { bio: 'nueva bio', location: 'Madrid' }

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
  })
})
