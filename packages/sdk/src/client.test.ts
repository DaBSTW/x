import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client.js'

describe('createApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends requests against the configured base URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({ baseUrl: 'https://api.example.com/v1' })
    await client.GET('/health')

    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.url).toBe('https://api.example.com/v1/health')
  })

  it('attaches the bearer token from getAccessToken when present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({
      baseUrl: 'https://api.example.com/v1',
      getAccessToken: () => 'the-access-token',
    })
    await client.GET('/health')

    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.headers.get('authorization')).toBe('Bearer the-access-token')
  })

  it('omits the Authorization header when getAccessToken returns null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createApiClient({
      baseUrl: 'https://api.example.com/v1',
      getAccessToken: () => null,
    })
    await client.GET('/health')

    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.headers.get('authorization')).toBeNull()
  })
})
