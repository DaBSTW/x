import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportWebVitalToRum, toRoutePattern } from './report-web-vitals.js'

describe('toRoutePattern', () => {
  it('replaces a single dynamic segment with its param name', () => {
    expect(toRoutePattern('/alice', { username: 'alice' })).toBe('/[username]')
  })

  it('replaces multiple dynamic segments', () => {
    expect(toRoutePattern('/alice/status/123', { username: 'alice', id: '123' })).toBe(
      '/[username]/status/[id]',
    )
  })

  it('leaves a static route untouched with no params', () => {
    expect(toRoutePattern('/home', {})).toBe('/home')
  })

  it('handles an array param (a catch-all segment)', () => {
    expect(toRoutePattern('/lists/a/b', { slug: ['a', 'b'] })).toBe('/lists/[slug]/[slug]')
  })

  it('never leaves a param value hiding in an unrelated static route', () => {
    // The landing page 3.4f's own bundle budget targets — must never be
    // mistaken for a dynamic route by this function.
    expect(toRoutePattern('/', {})).toBe('/')
  })
})

describe('reportWebVitalToRum', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a beacon with the metric, value, rating, path, and navigation type', () => {
    const sendBeacon = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { sendBeacon })

    reportWebVitalToRum(
      { name: 'LCP', value: 1800, rating: 'good', navigationType: 'navigate' },
      '/[username]',
    )

    expect(sendBeacon).toHaveBeenCalledTimes(1)
    const [url, blob] = sendBeacon.mock.calls[0] as [string, Blob]
    expect(url).toMatch(/\/rum$/)
    expect(blob.type).toBe('application/json')
  })

  it('sends the exact reported values, not re-derived ones', () => {
    const sendBeacon = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { sendBeacon })
    // JSDOM's own Blob can't be read back (no working .text()/Response
    // wrapping) — spying on the constructor itself, to see exactly what
    // this function passed it, sidesteps that runtime gap entirely rather
    // than fighting it. Captures the real Blob *before* stubbing it out —
    // the spy's own body would otherwise recurse into itself.
    const RealBlob = globalThis.Blob
    const BlobSpy = vi.fn(
      (parts: BlobPart[], options?: BlobPropertyBag) => new RealBlob(parts, options),
    )
    vi.stubGlobal('Blob', BlobSpy)

    reportWebVitalToRum(
      { name: 'CLS', value: 0.05, rating: 'needs-improvement', navigationType: 'reload' },
      '/home',
    )

    const [parts] = BlobSpy.mock.calls[0] as [string[], BlobPropertyBag]
    expect(JSON.parse(parts[0] as string)).toEqual({
      metric: 'CLS',
      value: 0.05,
      rating: 'needs-improvement',
      path: '/home',
      navigationType: 'reload',
    })
  })

  it('falls back to "poor" for a rating value web-vitals itself never actually sends', () => {
    const sendBeacon = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { sendBeacon })
    const RealBlob = globalThis.Blob
    const BlobSpy = vi.fn(
      (parts: BlobPart[], options?: BlobPropertyBag) => new RealBlob(parts, options),
    )
    vi.stubGlobal('Blob', BlobSpy)

    reportWebVitalToRum(
      { name: 'LCP', value: 1, rating: 'unexpected', navigationType: 'navigate' },
      '/',
    )

    const [parts] = BlobSpy.mock.calls[0] as [string[], BlobPropertyBag]
    expect(JSON.parse(parts[0] as string).rating).toBe('poor')
  })

  it('ignores a metric name this app does not accept', () => {
    const sendBeacon = vi.fn()
    vi.stubGlobal('navigator', { sendBeacon })

    reportWebVitalToRum(
      { name: 'Next.js-hydration', value: 1, rating: 'good', navigationType: 'navigate' },
      '/',
    )

    expect(sendBeacon).not.toHaveBeenCalled()
  })
})
