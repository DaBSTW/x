import { describe, expect, it } from 'vitest'
import { createPostSchema, postSchema } from './post.js'

describe('createPostSchema', () => {
  it('accepts a plain text post', () => {
    expect(createPostSchema.safeParse({ text: 'hola mundo' }).success).toBe(true)
  })

  it('accepts a media-only post with no text', () => {
    const result = createPostSchema.safeParse({ mediaIds: ['123'] })
    expect(result.success).toBe(true)
  })

  it('rejects an empty post (no text, no media)', () => {
    const result = createPostSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects text over 280 characters at the schema level', () => {
    const result = createPostSchema.safeParse({ text: 'a'.repeat(281) })
    expect(result.success).toBe(false)
  })

  it('rejects more than 4 media attachments', () => {
    const result = createPostSchema.safeParse({ mediaIds: ['1', '2', '3', '4', '5'] })
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
      media: [],
      conversationId: '123',
      inReplyToId: null,
      counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
    })

    expect(result.success).toBe(true)
  })

  it('accepts attached media items', () => {
    const result = postSchema.safeParse({
      id: '123',
      text: null,
      createdAt: '2026-08-11T00:00:00Z',
      author: { id: '1', username: 'ana', displayName: 'Ana', avatarUrl: null, isVerified: false },
      entities: [],
      media: [
        {
          id: '456',
          kind: 'image',
          url: 'https://cdn.example.com/m/456_large.webp',
          width: 1200,
          height: 800,
          blurhash: 'LEHV6nWB2yk8pyo0adR*',
          altText: 'Captura de la terminal',
        },
      ],
      conversationId: '123',
      inReplyToId: null,
      counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
    })

    expect(result.success).toBe(true)
  })

  it('accepts an optional viewer block, hydrated or not', () => {
    const base = {
      id: '123',
      text: 'hola',
      createdAt: '2026-08-11T00:00:00Z',
      author: { id: '1', username: 'ana', displayName: 'Ana', avatarUrl: null, isVerified: false },
      entities: [],
      media: [],
      conversationId: '123',
      inReplyToId: null,
      counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
    }

    expect(postSchema.safeParse(base).success).toBe(true)
    expect(
      postSchema.safeParse({
        ...base,
        viewer: { liked: true, reposted: false, bookmarked: false },
      }).success,
    ).toBe(true)
  })
})
