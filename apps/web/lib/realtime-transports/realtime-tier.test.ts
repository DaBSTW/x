import { describe, expect, it } from 'vitest'
import { nextRealtimeTier } from './realtime-tier.js'

describe('nextRealtimeTier', () => {
  it('falls back from websocket to sse', () => {
    expect(nextRealtimeTier('websocket')).toBe('sse')
  })

  it('falls back from sse to polling', () => {
    expect(nextRealtimeTier('sse')).toBe('polling')
  })

  it('polling has nowhere further to fall back to', () => {
    expect(nextRealtimeTier('polling')).toBe('polling')
  })
})
