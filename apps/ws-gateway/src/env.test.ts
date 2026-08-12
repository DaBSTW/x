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
    expect(env.WS_GATEWAY_PORT).toBe(3002)
    expect(env.CORS_ORIGIN).toBe('http://localhost:3000')
    expect(env.HEARTBEAT_INTERVAL_MS).toBe(30_000)
    expect(env.HEARTBEAT_TIMEOUT_MS).toBe(60_000)
    expect(env.BACKPRESSURE_LIMIT_BYTES).toBe(1_048_576)
  })

  it('throws EnvValidationError when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv
    expect(() => parseEnv(rest)).toThrow(EnvValidationError)
  })

  it('throws EnvValidationError when REDIS_URL is missing', () => {
    const { REDIS_URL: _omit, ...rest } = validEnv
    expect(() => parseEnv(rest)).toThrow(EnvValidationError)
  })

  it('coerces WS_GATEWAY_PORT from a string environment value', () => {
    const env = parseEnv({ ...validEnv, WS_GATEWAY_PORT: '4000' })
    expect(env.WS_GATEWAY_PORT).toBe(4000)
  })

  it('rejects a non-positive WS_GATEWAY_PORT', () => {
    expect(() => parseEnv({ ...validEnv, WS_GATEWAY_PORT: '0' })).toThrow(EnvValidationError)
  })

  it('rejects a non-URL CORS_ORIGIN', () => {
    expect(() => parseEnv({ ...validEnv, CORS_ORIGIN: 'not-a-url' })).toThrow(EnvValidationError)
  })

  it('coerces heartbeat and backpressure settings from string environment values, for tests that need a faster cadence than production', () => {
    const env = parseEnv({
      ...validEnv,
      HEARTBEAT_INTERVAL_MS: '50',
      HEARTBEAT_TIMEOUT_MS: '200',
      BACKPRESSURE_LIMIT_BYTES: '1024',
    })
    expect(env.HEARTBEAT_INTERVAL_MS).toBe(50)
    expect(env.HEARTBEAT_TIMEOUT_MS).toBe(200)
    expect(env.BACKPRESSURE_LIMIT_BYTES).toBe(1024)
  })
})
