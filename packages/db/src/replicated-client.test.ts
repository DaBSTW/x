import { describe, expect, it } from 'vitest'
import { createReplicatedDatabase } from './replicated-client.js'

// postgres.js connects lazily (on first query), so a fake connection string
// is fine here — this file only checks the no-replicas fallback shape,
// which never issues a query. The real routing behavior against a genuine
// primary + replica pair is replicated-client.integration.test.ts's job.
const FAKE_URL = 'postgres://x:x@localhost:1/x'

describe('createReplicatedDatabase', () => {
  it('still returns a fully Database-shaped object with no replica URLs configured', () => {
    const replicated = createReplicatedDatabase(FAKE_URL)
    expect(typeof replicated.select).toBe('function')
    expect(typeof replicated.insert).toBe('function')
    expect(typeof replicated.update).toBe('function')
    expect(typeof replicated.delete).toBe('function')
    expect(typeof replicated.transaction).toBe('function')
  })

  it('also works with an explicitly empty replica URL array', () => {
    const replicated = createReplicatedDatabase(FAKE_URL, [])
    expect(typeof replicated.select).toBe('function')
  })
})
