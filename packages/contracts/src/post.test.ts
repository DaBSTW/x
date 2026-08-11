import { describe, expect, it } from 'vitest'
import { createPostSchema, postSchema } from './post.js'

describe('createPostSchema', () => {
  it('accepts a plain text post', () => {
    expect(createPostSchema.safeParse({ text: 'hola mundo' }).success).toBe(true)
  })

  it('rejects an empty post (no text, no media yet)', () => {
    const result = createPostSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects text over 280 characters at the schema level', () => {
    const result = createPostSchema.safeParse({ text: 'a'.repeat(281) })
    expect(result.success).toBe(false)
  })

  it('defaults replyPolicy to everyone and isSensitive to false', () => {
    const result = createPostSchema.parse({ text: 'hola' })
    expect(result.replyPolicy).toBe('everyone')
    expect(result.isSensitive).toBe(false)
  })
})

describe('postSchema', () => {
  it('accepts a fully populated post', () => {
    const result = postSchema.safeParse({
      id: '123',
      text: 'hola',
      createdAt: '2026-08-11T00:00:00Z',
      author: {
        id: '1',
        username: 'ana',
        displayName: 'Ana',
        avatarUrl: null,
        isVerified: false,
      },
      entities: [],
      conversationId: '123',
      inReplyToId: null,
      counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
    })

    expect(result.success).toBe(true)
  })
})
