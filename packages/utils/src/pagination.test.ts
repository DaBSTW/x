import { describe, expect, it } from 'vitest'
import { ValidationError } from './errors.js'
import { decodeCursor, encodeCursor } from './pagination.js'

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a bigint id', () => {
    const id = 1823456789012345678n
    expect(decodeCursor(encodeCursor(id))).toBe(id)
  })

  it('produces an opaque, non-numeric-looking string', () => {
    const cursor = encodeCursor(123n)
    expect(cursor).not.toMatch(/^\d+$/)
  })

  it('throws ValidationError for garbage input', () => {
    expect(() => decodeCursor('not-a-real-cursor')).toThrow(ValidationError)
  })
})
