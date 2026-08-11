import { describe, expect, it } from 'vitest'
import { followListItemSchema } from './social-graph.js'

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
