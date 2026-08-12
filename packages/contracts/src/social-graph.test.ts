import { describe, expect, it } from 'vitest'
import { followListItemSchema, followResponseSchema } from './social-graph.js'

describe('followListItemSchema', () => {
  it('accepts a minimal follow list item', () => {
    const result = followListItemSchema.safeParse({
      id: '1',
      username: 'ana',
      displayName: 'Ana',
      avatarUrl: null,
      isVerified: false,
    })

    expect(result.success).toBe(true)
  })
})

describe('followResponseSchema', () => {
  it('accepts "following"', () => {
    expect(followResponseSchema.safeParse({ data: { status: 'following' } }).success).toBe(true)
  })

  it('accepts "requested" (ROADMAP.md 2.6)', () => {
    expect(followResponseSchema.safeParse({ data: { status: 'requested' } }).success).toBe(true)
  })

  it('rejects an unknown status', () => {
    expect(followResponseSchema.safeParse({ data: { status: 'pending' } }).success).toBe(false)
  })
})
