import { describe, expect, it } from 'vitest'
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  loginResponseSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  twoFactorLoginRequestSchema,
  verifyEmailRequestSchema,
  verifyTwoFactorRequestSchema,
} from './auth.js'

describe('registerRequestSchema', () => {
  it('accepts a valid registration payload', () => {
    const result = registerRequestSchema.safeParse({
      username: 'ana_dev',
      email: 'ana@example.com',
      password: 'correct horse battery staple',
      birthDate: '1990-01-01',
    })

    expect(result.success).toBe(true)
  })

  it.each([
    ['username with spaces', { username: 'ana dev' }],
    ['username too long', { username: 'a'.repeat(16) }],
    ['password too short', { password: 'short' }],
    ['invalid email', { email: 'not-an-email' }],
    ['invalid birth date', { birthDate: 'not-a-date' }],
  ])('rejects %s', (_label, overrides) => {
    const result = registerRequestSchema.safeParse({
      username: 'ana_dev',
      email: 'ana@example.com',
      password: 'correct horse battery staple',
      birthDate: '1990-01-01',
      ...overrides,
    })

    expect(result.success).toBe(false)
  })
})

describe('loginRequestSchema', () => {
  it('accepts email and a non-empty password', () => {
    expect(loginRequestSchema.safeParse({ email: 'ana@example.com', password: 'x' }).success).toBe(
      true,
    )
  })

  it('rejects an empty password', () => {
    expect(loginRequestSchema.safeParse({ email: 'ana@example.com', password: '' }).success).toBe(
      false,
    )
  })
})

describe('verifyEmailRequestSchema', () => {
  it('rejects an empty token', () => {
    expect(verifyEmailRequestSchema.safeParse({ token: '' }).success).toBe(false)
  })
})

describe('forgotPasswordRequestSchema', () => {
  it('rejects an invalid email', () => {
    expect(forgotPasswordRequestSchema.safeParse({ email: 'not-an-email' }).success).toBe(false)
  })
})

describe('resetPasswordRequestSchema', () => {
  it('rejects a password under the 10-character floor', () => {
    const result = resetPasswordRequestSchema.safeParse({ token: 't', password: 'short' })
    expect(result.success).toBe(false)
  })

  it('accepts a token and a strong-enough password', () => {
    const result = resetPasswordRequestSchema.safeParse({
      token: 't',
      password: 'correct horse battery staple',
    })
    expect(result.success).toBe(true)
  })
})

describe('changePasswordRequestSchema', () => {
  it('rejects an empty currentPassword', () => {
    const result = changePasswordRequestSchema.safeParse({
      currentPassword: '',
      newPassword: 'correct horse battery staple',
    })
    expect(result.success).toBe(false)
  })
})

describe('loginResponseSchema', () => {
  it('accepts an authenticated payload', () => {
    const result = loginResponseSchema.safeParse({
      data: { status: 'authenticated', accessToken: 'a', expiresInSeconds: 900 },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a requires_two_factor payload', () => {
    const result = loginResponseSchema.safeParse({
      data: { status: 'requires_two_factor', challengeToken: 't' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects an authenticated payload carrying a challengeToken instead of tokens', () => {
    const result = loginResponseSchema.safeParse({
      data: { status: 'authenticated', challengeToken: 't' },
    })
    expect(result.success).toBe(false)
  })
})

describe('verifyTwoFactorRequestSchema', () => {
  it('accepts a 6-digit code', () => {
    expect(verifyTwoFactorRequestSchema.safeParse({ code: '123456' }).success).toBe(true)
  })

  it.each([
    ['too short', '123'],
    ['non-numeric', 'abcdef'],
    ['a recovery code', 'a'.repeat(21)],
  ])('rejects %s', (_label, code) => {
    expect(verifyTwoFactorRequestSchema.safeParse({ code }).success).toBe(false)
  })
})

describe('twoFactorLoginRequestSchema', () => {
  it('accepts a challengeToken with either a TOTP or a recovery code', () => {
    expect(
      twoFactorLoginRequestSchema.safeParse({ challengeToken: 't', code: '123456' }).success,
    ).toBe(true)
    expect(
      twoFactorLoginRequestSchema.safeParse({
        challengeToken: 't',
        code: '0123456789-0123456789',
      }).success,
    ).toBe(true)
  })

  it('rejects an empty challengeToken', () => {
    const result = twoFactorLoginRequestSchema.safeParse({ challengeToken: '', code: '123456' })
    expect(result.success).toBe(false)
  })
})
