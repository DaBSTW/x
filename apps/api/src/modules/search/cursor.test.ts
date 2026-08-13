import { describe, expect, it } from 'vitest'
import { decodeSearchCursor, encodeSearchCursor } from './cursor.js'

describe('encodeSearchCursor / decodeSearchCursor', () => {
  it('round-trips a [score, id] sort tuple', () => {
    const cursor = encodeSearchCursor([12.5, '1823456789012345678'])
    expect(decodeSearchCursor(cursor)).toEqual([12.5, '1823456789012345678'])
  })

  it('round-trips a [date, id] sort tuple', () => {
    const cursor = encodeSearchCursor(['2026-08-01T12:00:00.000Z', '42'])
    expect(decodeSearchCursor(cursor)).toEqual(['2026-08-01T12:00:00.000Z', '42'])
  })

  it('produces an opaque, non-guessable-shape string — never a raw index/offset', () => {
    const cursor = encodeSearchCursor([0, '1'])
    expect(cursor).not.toContain('0')
    expect(cursor).not.toMatch(/^\d+$/)
  })

  it('throws ValidationError on a cursor this module never produced', () => {
    expect(() => decodeSearchCursor('not-a-real-cursor')).toThrow('invalid pagination cursor')
  })

  it('throws ValidationError when the decoded value is not an array', () => {
    const notAnArray = Buffer.from(JSON.stringify({ not: 'an array' })).toString('base64url')
    expect(() => decodeSearchCursor(notAnArray)).toThrow('invalid pagination cursor')
  })
})
