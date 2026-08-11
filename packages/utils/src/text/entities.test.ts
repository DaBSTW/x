import { describe, expect, it } from 'vitest'
import { parseEntities } from './entities.js'

describe('parseEntities', () => {
  it('extracts a mention with its code point offsets', () => {
    const entities = parseEntities('hola @ana_dev, ¿qué tal?')

    expect(entities).toContainEqual({ kind: 'mention', value: 'ana_dev', start: 5, end: 13 })
  })

  it('extracts a lowercased hashtag', () => {
    const entities = parseEntities('me encanta #TypeScript hoy')

    expect(entities).toContainEqual(
      expect.objectContaining({ kind: 'hashtag', value: 'typescript' }),
    )
  })

  it('extracts an uppercased cashtag', () => {
    const entities = parseEntities('comprando $aapl esta semana')

    expect(entities).toContainEqual(expect.objectContaining({ kind: 'cashtag', value: 'AAPL' }))
  })

  it('extracts a URL and does not double-count a hashtag inside its query string', () => {
    const text = 'mira esto https://example.com/post?tag=#trending gracias'
    const entities = parseEntities(text)

    const urls = entities.filter((entity) => entity.kind === 'url')
    const hashtags = entities.filter((entity) => entity.kind === 'hashtag')
    expect(urls).toHaveLength(1)
    expect(urls[0]?.value).toBe('https://example.com/post?tag=#trending')
    expect(hashtags).toHaveLength(0)
  })

  it('does not match an email-like @ as a mention', () => {
    const entities = parseEntities('contacto: ana@example.com')

    expect(entities.filter((entity) => entity.kind === 'mention')).toHaveLength(0)
  })

  it('handles multiple entities with correct, non-overlapping offsets', () => {
    const text = '@ana le gusta #dev y $msft'
    const entities = parseEntities(text)

    expect(entities).toEqual([
      { kind: 'mention', value: 'ana', start: 0, end: 4 },
      { kind: 'hashtag', value: 'dev', start: 14, end: 18 },
      { kind: 'cashtag', value: 'MSFT', start: 21, end: 26 },
    ])
  })

  describe('code point offsets survive multi-byte content', () => {
    it('keeps correct offsets after a compound (ZWJ) emoji', () => {
      // Family emoji: 👨‍👩‍👧‍👦 is one grapheme but 7 code points.
      const text = '👨‍👩‍👧‍👦 hola @ana'
      const entities = parseEntities(text)
      const codePoints = Array.from(text)

      const mention = entities.find((entity) => entity.kind === 'mention')
      expect(mention).toBeDefined()
      expect(codePoints.slice(mention?.start, mention?.end).join('')).toBe('@ana')
    })

    it('keeps correct offsets in right-to-left (Arabic) text', () => {
      const text = 'مرحبا @ana شكرا'
      const entities = parseEntities(text)
      const codePoints = Array.from(text)

      const mention = entities.find((entity) => entity.kind === 'mention')
      expect(mention).toBeDefined()
      expect(codePoints.slice(mention?.start, mention?.end).join('')).toBe('@ana')
    })

    it('keeps correct offsets after CJK characters', () => {
      const text = '你好世界 #中文 @ana'
      const entities = parseEntities(text)
      const codePoints = Array.from(text)

      const mention = entities.find((entity) => entity.kind === 'mention')
      const hashtag = entities.find((entity) => entity.kind === 'hashtag')
      expect(codePoints.slice(mention?.start, mention?.end).join('')).toBe('@ana')
      expect(hashtag?.value).toBe('中文')
    })
  })
})
