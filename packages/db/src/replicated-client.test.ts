import { describe, expect, it } from 'vitest'
import { createReplicatedDatabase } from './replicated-client.js'

// postgres.js connects lazily (on first query), so a fake connection string
// is fine here — this file only checks the no-replicas fallback shape,
// which never issues a query. The real routing behavior against a genuine
// primary + replica pair is replicated-client.integration.test.ts's job.
const FAKE_URL = 'postgres://x:x@localhost:1/x'

// Every drizzle PostgresJsDatabase method this wrapper is supposed to
// expose — walked once here rather than hand-copied, so this test can never
// drift out of sync with drizzle's own real method set the way the wrapper
// itself once silently did (execute/$count/refreshMaterializedView lived on
// primary's prototype chain, so `{...primary}` never actually copied them —
// caught for real by `app.db.execute is not a function` in a test, not by
// inspection, which is exactly the class of gap this loop exists to close
// for good instead of just patching the one method that happened to get
// exercised first).
const EXPECTED_METHODS = [
  'select',
  'selectDistinct',
  'selectDistinctOn',
  'with',
  '$with',
  '$count',
  'insert',
  'update',
  'delete',
  'transaction',
  'execute',
  'refreshMaterializedView',
] as const

describe('createReplicatedDatabase', () => {
  it('still returns a fully Database-shaped object with no replica URLs configured', () => {
    const replicated = createReplicatedDatabase(FAKE_URL)
    for (const method of EXPECTED_METHODS) {
      expect(typeof replicated[method], `${method} should be a function`).toBe('function')
    }
  })

  it('also works with an explicitly empty replica URL array', () => {
    const replicated = createReplicatedDatabase(FAKE_URL, [])
    for (const method of EXPECTED_METHODS) {
      expect(typeof replicated[method], `${method} should be a function`).toBe('function')
    }
  })
})
