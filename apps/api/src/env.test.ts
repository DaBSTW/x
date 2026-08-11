import { describe, expect, it } from 'vitest'
import { EnvValidationError, parseEnv } from './env.js'

const validEnv = {
  DATABASE_URL: 'postgres://x:x@localhost:5432/x',
  REDIS_URL: 'redis://localhost:6379',
}

describe('parseEnv', () => {
  it('applies defaults for a minimal development config', () => {
    const env = parseEnv(validEnv)

    expect(env.NODE_ENV).toBe('development')
    expect(env.API_PORT).toBe(3001)
    expect(env.JWT_ACCESS_TTL_MINUTES).toBe(15)
    expect(env.S3_BUCKET).toBe('x-media')
    expect(env.S3_FORCE_PATH_STYLE).toBe(true)
  })

  it('throws EnvValidationError when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv
    expect(() => parseEnv(rest)).toThrow(EnvValidationError)
  })

  it('throws EnvValidationError when REDIS_URL is missing', () => {
    const { REDIS_URL: _omit, ...rest } = validEnv
    expect(() => parseEnv(rest)).toThrow(EnvValidationError)
  })

  it('requires JWT keys in production but not in development', () => {
    expect(() => parseEnv({ ...validEnv, NODE_ENV: 'production' })).toThrow(EnvValidationError)
    expect(() =>
      parseEnv({
        ...validEnv,
        NODE_ENV: 'production',
        JWT_ACCESS_PRIVATE_KEY: 'key',
        JWT_ACCESS_PUBLIC_KEY: 'key',
      }),
    ).not.toThrow()
  })

  it('coerces numeric fields from string environment values', () => {
    const env = parseEnv({ ...validEnv, API_PORT: '4000', WORKER_ID: '7' })

    expect(env.API_PORT).toBe(4000)
    expect(env.WORKER_ID).toBe(7)
  })

  it('rejects a WORKER_ID outside the valid Snowflake range', () => {
    expect(() => parseEnv({ ...validEnv, WORKER_ID: '1024' })).toThrow(EnvValidationError)
  })
})
