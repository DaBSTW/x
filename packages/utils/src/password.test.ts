import { describe, expect, it } from 'vitest'
import { hashPassword, needsRehash, verifyPassword } from './password.js'

describe('hashPassword / verifyPassword', () => {
  it('produces a hash that verifies against the original password', async () => {
    const hash = await hashPassword('correct horse battery staple')

    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple')

    await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false)
  })

  it('produces a distinct hash for the same password (random salt)', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same password'),
      hashPassword('same password'),
    ])

    expect(first).not.toBe(second)
  })
})

describe('needsRehash', () => {
  it('returns false for a hash produced with the current parameters', async () => {
    const hash = await hashPassword('correct horse battery staple')

    expect(needsRehash(hash)).toBe(false)
  })

  it('returns true for a hash produced with weaker parameters', () => {
    const staleHash = '$argon2id$v=19$m=4096,t=1,p=1$c29tZXNhbHQ$c29tZWhhc2g'

    expect(needsRehash(staleHash)).toBe(true)
  })
})
