import { describe, expect, it } from 'vitest'
import { ClockDriftError, createSnowflakeGenerator, generateId } from './index.js'

describe('package public API', () => {
  it('exposes the snowflake generator and its error type', () => {
    expect(typeof createSnowflakeGenerator).toBe('function')
    expect(typeof generateId).toBe('function')
    expect(ClockDriftError.prototype).toBeInstanceOf(Error)
  })
})
