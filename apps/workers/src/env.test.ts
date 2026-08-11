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
    expect(env.FANOUT_WORKER_CONCURRENCY).toBe(4)
  })

  it('throws EnvValidationError when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv
    expect(() => parseEnv(rest)).toThrow(EnvValidationError)
  })

  it('throws EnvValidationError when REDIS_URL is missing', () => {
    const { REDIS_URL: _omit, ...rest } = validEnv
    expect(() => parseEnv(rest)).toThrow(EnvValidationError)
  })

  it('coerces FANOUT_WORKER_CONCURRENCY from a string environment value', () => {
    const env = parseEnv({ ...validEnv, FANOUT_WORKER_CONCURRENCY: '8' })
    expect(env.FANOUT_WORKER_CONCURRENCY).toBe(8)
  })

  it('rejects a non-positive FANOUT_WORKER_CONCURRENCY', () => {
    expect(() => parseEnv({ ...validEnv, FANOUT_WORKER_CONCURRENCY: '0' })).toThrow(
      EnvValidationError,
    )
  })
})
