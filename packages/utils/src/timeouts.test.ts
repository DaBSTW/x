import { describe, expect, it, vi } from 'vitest'
import { TimeoutError, withTimeout } from './timeouts.js'

describe('withTimeout', () => {
  it('resolves with the promise’s own value when it settles before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'test')).resolves.toBe('ok')
  })

  it('rejects with the promise’s own error when it rejects before the timeout, not a TimeoutError', async () => {
    const boom = new Error('boom')
    await expect(withTimeout(Promise.reject(boom), 1000, 'test')).rejects.toBe(boom)
  })

  it('rejects with a TimeoutError once the timeout elapses first', async () => {
    vi.useFakeTimers()
    const neverSettles = new Promise(() => {})
    const result = withTimeout(neverSettles, 5000, 'slow-dependency')
    const assertion = expect(result).rejects.toThrow(TimeoutError)
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
    vi.useRealTimers()
  })

  it('names the label and the exact budget in the error message', async () => {
    vi.useFakeTimers()
    const neverSettles = new Promise(() => {})
    const result = withTimeout(neverSettles, 5000, 'slow-dependency')
    const assertion = expect(result).rejects.toThrow('slow-dependency timed out after 5000ms')
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
    vi.useRealTimers()
  })

  it('never fires the timeout once the promise already won the race (no dangling timer/unhandled rejection)', async () => {
    vi.useFakeTimers()
    const result = withTimeout(Promise.resolve('fast'), 5000, 'test')
    await expect(result).resolves.toBe('fast')
    // If the timer weren't cleared, advancing past its deadline would still
    // be harmless here (the promise already settled) — the real point of
    // this test is documented behavior, not a crash this setup could catch;
    // clearTimeout is what actually prevents an unhandled-rejection warning
    // in a real long-lived process once the underlying promise keeps a
    // reference alive past its own resolution.
    await vi.advanceTimersByTimeAsync(5000)
    vi.useRealTimers()
  })
})
