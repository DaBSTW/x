import { describe, expect, it } from 'vitest'
import { isStreamIdNewer } from './stream-id.js'

describe('isStreamIdNewer', () => {
  it('compares the ms component first', () => {
    expect(isStreamIdNewer('200-0', '100-5')).toBe(true)
    expect(isStreamIdNewer('100-5', '200-0')).toBe(false)
  })

  it('falls back to the sequence component when ms is equal', () => {
    expect(isStreamIdNewer('100-2', '100-1')).toBe(true)
    expect(isStreamIdNewer('100-1', '100-2')).toBe(false)
  })

  it('is false for two equal ids', () => {
    expect(isStreamIdNewer('100-1', '100-1')).toBe(false)
  })

  it('compares numerically, not lexically — "9-0" is older than "10-0"', () => {
    expect(isStreamIdNewer('10-0', '9-0')).toBe(true)
    expect(isStreamIdNewer('9-0', '10-0')).toBe(false)
  })

  it('handles ms values beyond Number.MAX_SAFE_INTEGER precision', () => {
    const huge = `${Number.MAX_SAFE_INTEGER}9-0`
    expect(isStreamIdNewer(huge, '100-0')).toBe(true)
  })
})
