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
