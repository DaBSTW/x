import { describe, expect, it } from 'vitest'
import { updateUserSchema, userProfileSchema, usernameSchema } from './user.js'

describe('usernameSchema', () => {
  it('accepts a normal username', () => {
    expect(usernameSchema.safeParse('ana_92').success).toBe(true)
  })

  it('rejects characters outside letters, digits and underscore', () => {
    expect(usernameSchema.safeParse('ana-92').success).toBe(false)
  })

  it('rejects a username over 15 characters', () => {
    expect(usernameSchema.safeParse('a'.repeat(16)).success).toBe(false)
  })

  // Would otherwise be permanently shadowed by apps/web's static
  // /home route and unreachable at /:username.
  it('rejects a reserved route name, case-insensitively', () => {
    expect(usernameSchema.safeParse('home').success).toBe(false)
    expect(usernameSchema.safeParse('HOME').success).toBe(false)
  })
})

describe('userProfileSchema', () => {
  it('accepts a full profile with nullable fields set to null', () => {
    const result = userProfileSchema.safeParse({
      id: '1823456789012345678',
      username: 'ana',
      displayName: 'Ana',
      bio: null,
      location: null,
      websiteUrl: null,
      avatarUrl: null,
      bannerUrl: null,
      isProtected: false,
      isVerified: true,
      createdAt: '2026-08-11T14:32:00Z',
      counters: { followers: 0, following: 0, posts: 0 },
    })

    expect(result.success).toBe(true)
  })

  it('rejects a negative counter', () => {
    const result = userProfileSchema.safeParse({
      id: '1823456789012345678',
      username: 'ana',
      displayName: 'Ana',
      bio: null,
      location: null,
      websiteUrl: null,
      avatarUrl: null,
      bannerUrl: null,
      isProtected: false,
      isVerified: true,
      createdAt: '2026-08-11T14:32:00Z',
      counters: { followers: -1, following: 0, posts: 0 },
    })

    expect(result.success).toBe(false)
  })

  // ROADMAP.md 1.6/1.4: viewer.following/requested, only ever populated by
  // GET /users/:username for an authenticated, non-self caller.
  it('accepts a profile without viewer (the common case: anonymous or self)', () => {
    const result = userProfileSchema.safeParse({
      id: '1823456789012345678',
      username: 'ana',
      displayName: 'Ana',
      bio: null,
      location: null,
      websiteUrl: null,
      avatarUrl: null,
      bannerUrl: null,
      isProtected: false,
      isVerified: true,
      createdAt: '2026-08-11T14:32:00Z',
      counters: { followers: 0, following: 0, posts: 0 },
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.viewer).toBeUndefined()
  })

  it('accepts a profile with viewer.following/requested set', () => {
    const result = userProfileSchema.safeParse({
      id: '1823456789012345678',
      username: 'ana',
      displayName: 'Ana',
      bio: null,
      location: null,
      websiteUrl: null,
      avatarUrl: null,
      bannerUrl: null,
      isProtected: true,
      isVerified: false,
      createdAt: '2026-08-11T14:32:00Z',
      counters: { followers: 0, following: 0, posts: 0 },
      viewer: { following: false, requested: true },
    })

    expect(result.success).toBe(true)
  })
})

describe('updateUserSchema', () => {
  it('accepts a partial update', () => {
    expect(updateUserSchema.safeParse({ bio: 'new bio' }).success).toBe(true)
  })

  it('rejects a bio over 160 characters', () => {
    expect(updateUserSchema.safeParse({ bio: 'a'.repeat(161) }).success).toBe(false)
  })
})
