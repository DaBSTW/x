import { describe, expect, it } from 'vitest'
import { loginRequestSchema, snowflakeIdSchema, userProfileSchema } from './index.js'

describe('package public API', () => {
  it('re-exports schemas from every module', () => {
    expect(typeof loginRequestSchema.parse).toBe('function')
    expect(typeof snowflakeIdSchema.parse).toBe('function')
    expect(typeof userProfileSchema.parse).toBe('function')
  })
})
