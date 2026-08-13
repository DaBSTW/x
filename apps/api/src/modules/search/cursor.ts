import { ValidationError } from '@x/utils'

/**
 * Opaque cursor over OpenSearch's own `search_after` sort values — never a
 * raw offset (CODESTYLE.md §13's "nunca OFFSET para paginar" applies here
 * in spirit even though the rule was written for Postgres: `from`+`size`
 * has the exact same "re-scans and discards everything before it" cost
 * profile that rule exists to avoid, and OpenSearch's own docs cap it at
 * `index.max_result_window`, 10k by default). Generalizes
 * @x/utils' encodeCursor/decodeCursor (a single Snowflake id) to whatever
 * tuple a given sort actually produced — relevance-ranked results have no
 * id to page by on their own.
 */
export function encodeSearchCursor(sortValues: (string | number)[]): string {
  return Buffer.from(JSON.stringify(sortValues)).toString('base64url')
}

/** @throws {ValidationError} If `cursor` isn't a value this module produced. */
export function decodeSearchCursor(cursor: string): (string | number)[] {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!Array.isArray(decoded)) throw new Error('not an array')
    return decoded as (string | number)[]
  } catch (error) {
    throw new ValidationError('invalid pagination cursor', { cursor }, { cause: error })
  }
}
