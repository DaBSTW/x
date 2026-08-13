import { describe, expect, it } from 'vitest'
import { createPostSchema, createThreadSchema, postSchema } from './post.js'

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
      quotedPost: null,
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
          posterUrl: null,
          width: 1200,
          height: 800,
          durationMs: null,
          blurhash: 'LEHV6nWB2yk8pyo0adR*',
          altText: 'Captura de la terminal',
        },
      ],
      conversationId: '123',
      inReplyToId: null,
      counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
      quotedPost: null,
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
      quotedPost: null,
    }

    expect(postSchema.safeParse(base).success).toBe(true)
    expect(
      postSchema.safeParse({
        ...base,
        viewer: { liked: true, reposted: false, bookmarked: false },
      }).success,
    ).toBe(true)
  })

  it('accepts a quote embedding the post it quotes, one level deep', () => {
    const inner = {
      id: '456',
      text: 'post original',
      createdAt: '2026-08-11T00:00:00Z',
      author: { id: '2', username: 'bob', displayName: 'Bob', avatarUrl: null, isVerified: false },
      entities: [],
      media: [],
      conversationId: '456',
      inReplyToId: null,
      counters: { likes: 0, reposts: 0, replies: 0, quotes: 1, views: 0 },
    }
    const result = postSchema.safeParse({
      id: '123',
      text: 'una cita',
      createdAt: '2026-08-11T00:00:00Z',
      author: { id: '1', username: 'ana', displayName: 'Ana', avatarUrl: null, isVerified: false },
      entities: [],
      media: [],
      conversationId: '123',
      inReplyToId: null,
      counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
      quotedPost: inner,
    })

    expect(result.success).toBe(true)
    expect(result.success && result.data.quotedPost?.text).toBe('post original')
  })

  it('strips a second level of nesting instead of failing the parse — the wire contract stays one level deep no matter what a caller hands it', () => {
    const innerWithSpuriousNesting = {
      id: '456',
      text: 'post original',
      createdAt: '2026-08-11T00:00:00Z',
      author: { id: '2', username: 'bob', displayName: 'Bob', avatarUrl: null, isVerified: false },
      entities: [],
      media: [],
      conversationId: '456',
      inReplyToId: null,
      counters: { likes: 0, reposts: 0, replies: 0, quotes: 1, views: 0 },
      // Not part of the embedded schema — must be dropped by Zod's default
      // strip-unknown-keys behavior on parse, not rejected outright: this is
      // what actually keeps the *serialized* response bounded to one level
      // (fastify-type-provider-zod serializes `schema.safeParse(data).data`,
      // not the raw handler return value — see posts.service.ts's toPostDto).
      quotedPost: { id: '789', shouldNotSurvive: true },
    }
    const result = postSchema.safeParse({
      id: '123',
      text: 'una cita',
      createdAt: '2026-08-11T00:00:00Z',
      author: { id: '1', username: 'ana', displayName: 'Ana', avatarUrl: null, isVerified: false },
      entities: [],
      media: [],
      conversationId: '123',
      inReplyToId: null,
      counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
      quotedPost: innerWithSpuriousNesting,
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.quotedPost?.id).toBe('456')
    expect(Object.keys(result.data.quotedPost ?? {})).not.toContain('quotedPost')
  })

  it('rejects a post missing the required quotedPost key', () => {
    const result = postSchema.safeParse({
      id: '123',
      text: 'hola',
      createdAt: '2026-08-11T00:00:00Z',
      author: { id: '1', username: 'ana', displayName: 'Ana', avatarUrl: null, isVerified: false },
      entities: [],
      media: [],
      conversationId: '123',
      inReplyToId: null,
      counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
    })

    expect(result.success).toBe(false)
  })
})

describe('createThreadSchema', () => {
  it('accepts a thread of plain-text posts', () => {
    const result = createThreadSchema.safeParse({
      posts: [{ text: 'uno' }, { text: 'dos' }, { text: 'tres' }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a single-post thread', () => {
    expect(createThreadSchema.safeParse({ posts: [{ text: 'solo uno' }] }).success).toBe(true)
  })

  it('rejects an empty thread', () => {
    expect(createThreadSchema.safeParse({ posts: [] }).success).toBe(false)
  })

  it('rejects more than 25 posts', () => {
    const posts = Array.from({ length: 26 }, (_, i) => ({ text: `post ${i}` }))
    expect(createThreadSchema.safeParse({ posts }).success).toBe(false)
  })

  it('rejects a thread item with neither text nor media', () => {
    const result = createThreadSchema.safeParse({ posts: [{ text: 'uno' }, {}] })
    expect(result.success).toBe(false)
  })

  it('accepts a media-only thread item', () => {
    const result = createThreadSchema.safeParse({ posts: [{ mediaIds: ['123'] }] })
    expect(result.success).toBe(true)
  })

  it('accepts an optional inReplyToId, applying to the thread as a whole', () => {
    const result = createThreadSchema.safeParse({
      posts: [{ text: 'uno' }],
      inReplyToId: '456',
    })
    expect(result.success).toBe(true)
  })

  it('defaults replyPolicy to everyone', () => {
    const result = createThreadSchema.parse({ posts: [{ text: 'uno' }] })
    expect(result.replyPolicy).toBe('everyone')
  })
})
