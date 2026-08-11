import { describe, expect, it } from 'vitest'
import { updateUserSchema, userProfileSchema } from './user.js'

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
