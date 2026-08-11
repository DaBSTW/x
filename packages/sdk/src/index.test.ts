import { describe, expect, it } from 'vitest'
import { createApiClient } from './index.js'

describe('package public API', () => {
  it('exposes createApiClient', () => {
    expect(typeof createApiClient).toBe('function')
  })
})
