import { describe, expect, it, vi } from 'vitest'
import { jitterTtlSeconds } from './cache.js'

describe('jitterTtlSeconds', () => {
  it('stays within ±10% of the base by default', () => {
    for (let i = 0; i < 200; i++) {
      const result = jitterTtlSeconds(1000)
      expect(result).toBeGreaterThanOrEqual(900)
      expect(result).toBeLessThanOrEqual(1100)
    }
  })

  it('respects a custom jitter ratio', () => {
    for (let i = 0; i < 200; i++) {
      const result = jitterTtlSeconds(1000, 0.5)
      expect(result).toBeGreaterThanOrEqual(500)
      expect(result).toBeLessThanOrEqual(1500)
    }
  })

  it('produces different values across calls (it actually jitters, not a no-op)', () => {
    const results = new Set(Array.from({ length: 50 }, () => jitterTtlSeconds(100_000)))
    expect(results.size).toBeGreaterThan(1)
  })

  it('never returns less than 1 second, even for a tiny base TTL', () => {
    for (let i = 0; i < 200; i++) {
      expect(jitterTtlSeconds(1)).toBeGreaterThanOrEqual(1)
    }
  })

  it('rejects a jitter ratio outside [0, 1]', () => {
    expect(() => jitterTtlSeconds(1000, -0.1)).toThrow(RangeError)
    expect(() => jitterTtlSeconds(1000, 1.1)).toThrow(RangeError)
  })

  it('is a no-op with jitterRatio 0', () => {
    expect(jitterTtlSeconds(1000, 0)).toBe(1000)
  })

  it('rounds to the nearest whole second', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.75) // offset = 0.5 * spread
    expect(jitterTtlSeconds(1000, 0.1)).toBe(Math.round(1000 + 0.5 * 100))
    vi.restoreAllMocks()
  })
})
