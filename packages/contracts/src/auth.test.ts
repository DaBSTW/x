import { describe, expect, it } from 'vitest'
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
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
