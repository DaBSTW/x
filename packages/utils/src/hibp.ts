import { createHash } from 'node:crypto'

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/'
const REQUEST_TIMEOUT_MS = 3_000

/**
 * Checks whether `password` appears in the Have I Been Pwned breach corpus,
 * using k-anonymity: only a 5-character SHA-1 prefix ever leaves the process,
 * never the password itself — SPECS.md §11.2.
 *
 * @throws {Error} On a network failure, timeout, or non-2xx response. This is
 * a third-party dependency on the registration path — the caller decides how
 * to degrade (SPECS.md §14.4 / CODESTYLE.md §8.3), this function never
 * silently reports "not pwned" for a check that didn't actually run.
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase()
  const prefix = sha1.slice(0, 5)
  const suffix = sha1.slice(5)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${HIBP_RANGE_URL}${prefix}`, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HIBP range API responded with ${response.status}`)
    }

    const body = await response.text()
    return body.split('\n').some((line) => line.split(':')[0] === suffix)
  } finally {
    clearTimeout(timeout)
  }
}
