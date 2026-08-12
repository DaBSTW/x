import { describe, expect, it } from 'vitest'
import { generateTotp, generateTotpSecret, totpKeyUri, verifyTotp } from './totp.js'

describe('generateTotpSecret', () => {
  it('generates distinct secrets on each call', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret())
  })
})

describe('totpKeyUri', () => {
  it('builds an otpauth:// URI carrying the issuer, account label, and secret', () => {
    const uri = totpKeyUri('alice', 'JBSWY3DPEHPK3PXP')
    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    expect(uri).toContain('alice')
    expect(uri).toContain('JBSWY3DPEHPK3PXP')
    expect(uri).toContain('X') // issuer
  })
})

describe('generateTotp', () => {
  it('generates a 6-digit code that verifyTotp accepts', async () => {
    const secret = generateTotpSecret()
    const code = await generateTotp(secret)
    expect(code).toMatch(/^\d{6}$/)
    expect(await verifyTotp(secret, code)).toMatchObject({ valid: true })
  })
})

describe('verifyTotp', () => {
  it('accepts a code generated for the current time step', async () => {
    const secret = generateTotpSecret()
    const code = await generateTotp(secret)
    expect(await verifyTotp(secret, code)).toEqual({ valid: true, timeStep: expect.any(Number) })
  })

  it('rejects an incorrect code', async () => {
    const secret = generateTotpSecret()
    expect(await verifyTotp(secret, '000000')).toEqual({ valid: false })
  })

  it('rejects a code at or before the given afterTimeStep (replay protection)', async () => {
    const secret = generateTotpSecret()
    const now = Math.floor(Date.now() / 1000)
    const code = await generateTotp(secret, now)
    const result = await verifyTotp(secret, code)
    if (!result.valid) throw new Error('expected the first verification to succeed')

    expect(await verifyTotp(secret, code, result.timeStep)).toEqual({ valid: false })
  })
})
