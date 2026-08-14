import { describe, expect, it } from 'vitest'
import { deriveSseUrl } from './sse-url.js'

describe('deriveSseUrl', () => {
  it('maps ws: to http: and appends /sse to the path', () => {
    expect(deriveSseUrl('ws://localhost:3002/v1')).toBe('http://localhost:3002/v1/sse')
  })

  it('maps wss: to https:, preserving a production-style host', () => {
    expect(deriveSseUrl('wss://realtime.example.com/v1')).toBe(
      'https://realtime.example.com/v1/sse',
    )
  })

  it('handles a base URL with no trailing path segment', () => {
    expect(deriveSseUrl('ws://localhost:3002')).toBe('http://localhost:3002/sse')
  })

  it('does not double a trailing slash before appending /sse', () => {
    expect(deriveSseUrl('ws://localhost:3002/v1/')).toBe('http://localhost:3002/v1/sse')
  })
})
