import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePrefersReducedMotion } from './use-reduced-motion.js'

/** A minimal but real MediaQueryList-shaped fake — captures the listener usePrefersReducedMotion registers so a test can fire a real 'change' event through it, not just read the initial value. */
function stubMatchMedia(initialMatches: boolean): {
  fireChange: (matches: boolean) => void
} {
  let listener: ((event: MediaQueryListEvent) => void) | null = null
  const mediaQueryList = {
    matches: initialMatches,
    addEventListener: (_event: 'change', callback: (event: MediaQueryListEvent) => void) => {
      listener = callback
    },
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mediaQueryList))
  return {
    fireChange(matches: boolean) {
      mediaQueryList.matches = matches
      listener?.({ matches } as MediaQueryListEvent)
    },
  }
}

describe('usePrefersReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reflects the OS preference already in place on mount', () => {
    stubMatchMedia(true)
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(true)
  })

  it('defaults to false when the OS has no reduced-motion preference', () => {
    stubMatchMedia(false)
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false)
  })

  it('updates live when the OS preference changes mid-session, without a remount', () => {
    const { fireChange } = stubMatchMedia(false)
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false)

    act(() => {
      fireChange(true)
    })
    expect(result.current).toBe(true)
  })
})
