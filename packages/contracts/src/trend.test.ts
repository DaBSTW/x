import { describe, expect, it } from 'vitest'
import { trendSchema, trendsQuerySchema } from './trend.js'

describe('trendSchema', () => {
  it('accepts a real trend row', () => {
    expect(
      trendSchema.safeParse({
        hashtag: 'mundial',
        score: 12.34,
        postCount1h: 200,
        uniqueAuthors1h: 80,
      }).success,
    ).toBe(true)
  })

  it('rejects a negative postCount1h', () => {
    expect(
      trendSchema.safeParse({
        hashtag: 'mundial',
        score: 1,
        postCount1h: -1,
        uniqueAuthors1h: 1,
      }).success,
    ).toBe(false)
  })
})

describe('trendsQuerySchema', () => {
  it('defaults limit to 10 and leaves lang unset', () => {
    const result = trendsQuerySchema.parse({})
    expect(result).toEqual({ limit: 10 })
  })

  it('coerces a string limit from the querystring', () => {
    expect(trendsQuerySchema.parse({ limit: '25' }).limit).toBe(25)
  })

  it('rejects a limit above 50', () => {
    expect(trendsQuerySchema.safeParse({ limit: '51' }).success).toBe(false)
  })

  it('rejects a limit below 1', () => {
    expect(trendsQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
  })

  it('accepts a lang code', () => {
    expect(trendsQuerySchema.parse({ lang: 'es' })).toEqual({ lang: 'es', limit: 10 })
  })

  it('rejects a one-character lang', () => {
    expect(trendsQuerySchema.safeParse({ lang: 'e' }).success).toBe(false)
  })
})
