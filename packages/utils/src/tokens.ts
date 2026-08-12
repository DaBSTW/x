import { createHash, randomBytes } from 'node:crypto'

/** Generates a cryptographically random opaque token (base64url, no padding). */
export function generateOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url')
}

/**
 * SHA-256 of `value`, hex-encoded. Used to store opaque tokens (refresh
 * tokens, email verification tokens) at rest — the raw value is only ever
 * seen once, by the client it was issued to (SPECS.md §11.1).
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * A single 2FA recovery code (ROADMAP.md 2.6) — hex rather than
 * {@link generateOpaqueToken}'s base64url so there's no mixed case or
 * `-`/`_` to mistype when copying it down by hand. Hyphenated in the middle
 * purely for readability; the 80 bits of entropy is what actually matters.
 */
export function generateRecoveryCode(): string {
  const raw = randomBytes(10).toString('hex')
  return `${raw.slice(0, 10)}-${raw.slice(10)}`
}
