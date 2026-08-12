import { describe, expect, it } from 'vitest'
import { generateOpaqueToken, generateRecoveryCode, sha256Hex } from './tokens.js'

describe('generateOpaqueToken', () => {
  it('generates distinct tokens on each call', () => {
    expect(generateOpaqueToken()).not.toBe(generateOpaqueToken())
  })

  it('encodes without url-unsafe characters', () => {
    const token = generateOpaqueToken()
    expect(token).not.toMatch(/[+/=]/)
  })
})

describe('sha256Hex', () => {
  it('is deterministic for the same input', () => {
    expect(sha256Hex('hello')).toBe(sha256Hex('hello'))
  })

  it('matches the known SHA-256 digest of "hello"', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('produces different digests for different inputs', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'))
  })
})

describe('generateRecoveryCode', () => {
  it('generates distinct codes on each call', () => {
    expect(generateRecoveryCode()).not.toBe(generateRecoveryCode())
  })

  it('formats as two hyphenated 10-character hex groups', () => {
    expect(generateRecoveryCode()).toMatch(/^[0-9a-f]{10}-[0-9a-f]{10}$/)
  })
})
