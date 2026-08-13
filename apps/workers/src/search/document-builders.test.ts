import { describe, expect, it } from 'vitest'
import {
  type PostDocumentInput,
  buildPostDocument,
  buildUserDocument,
  computeEngagement,
} from './document-builders.js'

const CREATED_AT = new Date('2026-08-01T12:00:00.000Z')

function basePostInput(overrides: Partial<PostDocumentInput> = {}): PostDocumentInput {
  return {
    id: 1n,
    authorId: 2n,
    authorHandle: 'ana',
    text: 'hola mundo',
    lang: 'es',
    isSensitive: false,
    hasMedia: false,
    createdAt: CREATED_AT,
    counters: null,
    ...overrides,
  }
}

describe('buildPostDocument', () => {
  it('stringifies both ids — never a raw bigint, which JSON.stringify cannot serialize', () => {
    const doc = buildPostDocument(basePostInput({ id: 9223372036854775001n, authorId: 2n }))
    expect(doc.id).toBe('9223372036854775001')
    expect(doc.author_id).toBe('2')
    expect(() => JSON.stringify(doc)).not.toThrow()
  })

  it('extracts hashtags (lowercased by parseEntities itself) and mentions (lowercased here) from text', () => {
    const doc = buildPostDocument(
      basePostInput({ text: 'Vamos #Mundial2026 con @AnaCapital y @otro' }),
    )
    expect(doc.hashtags).toEqual(['mundial2026'])
    expect(doc.mentions).toEqual(['anacapital', 'otro'])
  })

  it('has no hashtags/mentions for plain text, and treats a null text as empty', () => {
    expect(buildPostDocument(basePostInput({ text: 'sin nada especial' })).hashtags).toEqual([])
    const doc = buildPostDocument(basePostInput({ text: null }))
    expect(doc.text).toBe('')
    expect(doc.hashtags).toEqual([])
    expect(doc.mentions).toEqual([])
  })

  it('carries lang/is_sensitive/has_media/created_at straight through', () => {
    const doc = buildPostDocument(
      basePostInput({ lang: 'en', isSensitive: true, hasMedia: true, createdAt: CREATED_AT }),
    )
    expect(doc.lang).toBe('en')
    expect(doc.is_sensitive).toBe(true)
    expect(doc.has_media).toBe(true)
    expect(doc.created_at).toBe(CREATED_AT.toISOString())
  })

  it('falls back to an empty author_handle rather than crashing when the author lookup came up empty', () => {
    const doc = buildPostDocument(basePostInput({ authorHandle: '' }))
    expect(doc.author_handle).toBe('')
  })

  it('computes engagement from the joined counters row', () => {
    const doc = buildPostDocument(
      basePostInput({
        counters: { likesCount: 10, repostsCount: 2, repliesCount: 3, quotesCount: 1 },
      }),
    )
    expect(doc.engagement).toBe(16)
  })
})

describe('computeEngagement', () => {
  it('sums likes/reposts/replies/quotes — deliberately excluding bookmarks (private) and views (unpopulated until phase 3)', () => {
    expect(
      computeEngagement({ likesCount: 5, repostsCount: 1, repliesCount: 2, quotesCount: 0 }),
    ).toBe(8)
  })

  it('is 0 when there is no counters row yet (a post indexed the instant it was created)', () => {
    expect(computeEngagement(null)).toBe(0)
  })
})

describe('buildUserDocument', () => {
  it('stringifies the id and defaults a missing followers_count to 0', () => {
    const doc = buildUserDocument({
      id: 9223372036854775001n,
      username: 'ana',
      displayName: 'Ana',
      isVerified: false,
      followersCount: null,
    })
    expect(doc.id).toBe('9223372036854775001')
    expect(doc.followers_count).toBe(0)
    expect(() => JSON.stringify(doc)).not.toThrow()
  })

  it('carries username/display_name/is_verified/followers_count straight through when present', () => {
    const doc = buildUserDocument({
      id: 1n,
      username: 'ana',
      displayName: 'Ana Capital',
      isVerified: true,
      followersCount: 42,
    })
    expect(doc).toEqual({
      id: '1',
      username: 'ana',
      display_name: 'Ana Capital',
      followers_count: 42,
      is_verified: true,
    })
  })
})
