import { describe, expect, it } from 'vitest'
import { countCharacters } from './character-count.js'

describe('countCharacters', () => {
  it('counts plain ASCII text by character', () => {
    expect(countCharacters('hello world')).toBe(11)
  })

  it('counts a compound (ZWJ) emoji as a single grapheme', () => {
    // Family emoji: 4 people joined by ZWJ — 7 code points, 1 grapheme.
    const family = '👨‍👩‍👧‍👦'
    expect(countCharacters(family)).toBe(1)
    expect(countCharacters(`${family} hola`)).toBe(1 + 5)
  })

  it('counts right-to-left (Arabic) text by grapheme, not byte', () => {
    expect(countCharacters('مرحبا')).toBe(5)
  })

  it('counts CJK characters one per character', () => {
    expect(countCharacters('你好世界')).toBe(4)
  })

  it('counts a URL as exactly 23 characters regardless of its real length', () => {
    const shortUrl = 'https://x.co'
    const longUrl = 'https://example.com/a/very/long/path?with=lots&of=query&params=here'

    expect(countCharacters(shortUrl)).toBe(23)
    expect(countCharacters(longUrl)).toBe(23)
  })

  it('counts surrounding text plus 23 for an embedded URL', () => {
    const text = 'mira esto https://example.com/x gracias'
    // "mira esto " (10) + 23 + " gracias" (8)
    expect(countCharacters(text)).toBe(10 + 23 + 8)
  })

  it('sums multiple URLs at 23 each', () => {
    const text = 'https://a.co y https://b.co'
    // 23 + " y " (3) + 23
    expect(countCharacters(text)).toBe(23 + 3 + 23)
  })

  it('handles an empty string', () => {
    expect(countCharacters('')).toBe(0)
  })

  it('accepts exactly 280 graphemes as the post limit boundary', () => {
    const text = 'a'.repeat(280)
    expect(countCharacters(text)).toBe(280)
  })
})
