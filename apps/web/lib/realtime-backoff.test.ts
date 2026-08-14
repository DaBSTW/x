import { describe, expect, it } from 'vitest'
import { MAX_CONSECUTIVE_TRANSPORT_FAILURES, nextReconnectDelayMs } from './realtime-backoff.js'

describe('nextReconnectDelayMs', () => {
  it('starts around 1s on the first attempt', () => {
    expect(nextReconnectDelayMs(0, () => 0.5)).toBe(1_000) // no jitter at the midpoint
  })

  it('doubles with each attempt', () => {
    expect(nextReconnectDelayMs(1, () => 0.5)).toBe(2_000)
    expect(nextReconnectDelayMs(2, () => 0.5)).toBe(4_000)
    expect(nextReconnectDelayMs(3, () => 0.5)).toBe(8_000)
    expect(nextReconnectDelayMs(4, () => 0.5)).toBe(16_000)
  })

  it('caps at 30s once the exponential curve would exceed it', () => {
    expect(nextReconnectDelayMs(5, () => 0.5)).toBe(30_000) // 1000*2^5 = 32000, capped
    expect(nextReconnectDelayMs(20, () => 0.5)).toBe(30_000)
  })

  it('applies up to ±20% jitter around the exponential value', () => {
    expect(nextReconnectDelayMs(0, () => 1)).toBe(1_200) // +20%
    expect(nextReconnectDelayMs(0, () => 0)).toBe(800) // -20%
  })

  it('never returns a delay above the 30s ceiling even with positive jitter', () => {
    expect(nextReconnectDelayMs(5, () => 1)).toBe(30_000)
  })

  it('never returns a negative delay', () => {
    expect(nextReconnectDelayMs(0, () => 0)).toBeGreaterThanOrEqual(0)
  })
})

describe('MAX_CONSECUTIVE_TRANSPORT_FAILURES', () => {
  it('is a positive integer — 0 would give a transport no chance to connect at all', () => {
    expect(Number.isInteger(MAX_CONSECUTIVE_TRANSPORT_FAILURES)).toBe(true)
    expect(MAX_CONSECUTIVE_TRANSPORT_FAILURES).toBeGreaterThan(0)
  })
})
