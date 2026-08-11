import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPasswordPwned } from './hibp.js'

describe('isPasswordPwned', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns true when the suffix is present in the range response', async () => {
    // sha1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\nAAAA:1'),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await isPasswordPwned('password')

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.pwnedpasswords.com/range/5BAA6'),
      expect.anything(),
    )
  })

  it('returns false when the suffix is absent from the range response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1'),
      }),
    )

    await expect(isPasswordPwned('a very unusual passphrase indeed')).resolves.toBe(false)
  })

  it('throws when the API responds with a non-2xx status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve('') }),
    )

    await expect(isPasswordPwned('anything')).rejects.toThrow('503')
  })

  it('propagates a network failure instead of reporting "not pwned"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')))

    await expect(isPasswordPwned('anything')).rejects.toThrow('network unreachable')
  })
})
