import { ValidationError } from './errors.js'

/**
 * Opaque cursor pagination over Snowflake IDs — SPECS.md §5.2. Never OFFSET
 * (CODESTYLE.md §13): the cursor is the last-seen ID, base64url-encoded so
 * clients treat it as opaque rather than depending on its shape.
 */
export function encodeCursor(id: bigint): string {
  return Buffer.from(JSON.stringify({ id: id.toString() })).toString('base64url')
}

/** @throws {ValidationError} If `cursor` isn't a value this module produced. */
export function decodeCursor(cursor: string): bigint {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { id: string }
    return BigInt(decoded.id)
  } catch (error) {
    throw new ValidationError('invalid pagination cursor', { cursor }, { cause: error })
  }
}
