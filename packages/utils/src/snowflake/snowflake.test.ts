import { describe, expect, it } from 'vitest'
import {
  ClockDriftError,
  createSnowflakeGenerator,
  extractTimestamp,
  extractWorkerId,
} from './snowflake.js'

// Fixed point after the generator's custom epoch (2024-01-01). Using a real
// post-epoch timestamp keeps `timestamp - EPOCH_MS` non-negative, which is the
// case in production (Date.now() is always after 2024) and avoids exercising
// bigint two's-complement bit-packing edge cases that a raw 1970-epoch mock
// clock would trigger.
const BASE_MS = Date.UTC(2026, 7, 11, 0, 0, 0)

describe('createSnowflakeGenerator', () => {
  it('rejects a worker id outside the 10-bit range', () => {
    expect(() => createSnowflakeGenerator(-1)).toThrow(RangeError)
    expect(() => createSnowflakeGenerator(1024)).toThrow(RangeError)
    expect(() => createSnowflakeGenerator(1.5)).toThrow(RangeError)
  })

  it('generates 1,000,000 ids with no collisions and strictly increasing values', () => {
    const generator = createSnowflakeGenerator(7)
    const ids = new Set<bigint>()
    let previous = -1n

    for (let i = 0; i < 1_000_000; i++) {
      const id = generator.nextId()
      expect(id).toBeGreaterThan(previous)
      ids.add(id)
      previous = id
    }

    expect(ids.size).toBe(1_000_000)
  })

  it('round-trips the timestamp and worker id encoded in the id', () => {
    const generator = createSnowflakeGenerator(42, () => BASE_MS)

    const id = generator.nextId()

    expect(extractTimestamp(id)).toBe(BASE_MS)
    expect(extractWorkerId(id)).toBe(42)
  })

  it('waits for the clock instead of producing a duplicate on small backwards drift', () => {
    const clockValues = [BASE_MS, BASE_MS - 10, BASE_MS - 5, BASE_MS + 1]
    let callCount = 0
    const now = () => {
      const value = clockValues[callCount] ?? BASE_MS
      callCount++
      return value
    }

    const generator = createSnowflakeGenerator(1, now)
    const first = generator.nextId()
    const second = generator.nextId()

    expect(second).toBeGreaterThan(first)
    expect(extractTimestamp(first)).toBe(BASE_MS)
    expect(extractTimestamp(second)).toBe(BASE_MS + 1)
  })

  it('throws ClockDriftError when the clock jumps backwards by more than 100ms', () => {
    const clockValues = [BASE_MS, BASE_MS - 200]
    let callCount = 0
    const now = () => {
      const value = clockValues[callCount]
      callCount++
      return value ?? BASE_MS
    }

    const generator = createSnowflakeGenerator(1, now)
    generator.nextId()

    expect(() => generator.nextId()).toThrow(ClockDriftError)
  })

  it('rolls over to the next millisecond when the sequence is exhausted', () => {
    let tick = 0
    // The 12-bit sequence covers 4096 values (0..4095) per millisecond; the
    // 4097th id in the same ms must spin until the clock ticks forward.
    const now = () => (tick < 4_097 ? BASE_MS : BASE_MS + 1)

    const generator = createSnowflakeGenerator(1, () => {
      const value = now()
      tick++
      return value
    })

    let lastId = -1n
    for (let i = 0; i < 4_097; i++) {
      const id = generator.nextId()
      expect(id).toBeGreaterThan(lastId)
      lastId = id
    }

    expect(extractTimestamp(lastId)).toBe(BASE_MS + 1)
  })
})
