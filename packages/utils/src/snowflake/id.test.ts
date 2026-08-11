import { afterEach, describe, expect, it, vi } from 'vitest'

describe('generateId', () => {
  const originalWorkerId = process.env.WORKER_ID

  afterEach(() => {
    if (originalWorkerId === undefined) {
      // biome-ignore lint/performance/noDelete: assigning undefined stringifies to "undefined" on process.env
      delete process.env.WORKER_ID
    } else {
      process.env.WORKER_ID = originalWorkerId
    }
    vi.resetModules()
  })

  it('defaults to worker id 0 when WORKER_ID is unset', async () => {
    // biome-ignore lint/performance/noDelete: see afterEach above.
    delete process.env.WORKER_ID
    vi.resetModules()
    const { generateId } = await import('./id.js')

    expect(typeof generateId()).toBe('bigint')
  })

  it('rejects a non-integer WORKER_ID at module load', async () => {
    process.env.WORKER_ID = 'not-a-number'
    vi.resetModules()

    await expect(import('./id.js')).rejects.toThrow(RangeError)
  })
})
