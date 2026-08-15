import { describe, expect, it } from 'vitest'
import {
  didWriteDuringRequest,
  enterReadWriteContext,
  markWroteDuringRequest,
  shouldPreferPrimary,
} from './read-write-context.js'

/** Simulates one Fastify request: a genuinely separate async chain, the same way apps/api's read-write-routing plugin's onRequest hook starts one per real request. */
function runAsRequest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      fn().then(resolve, reject)
    })
  })
}

describe('read-write-context', () => {
  it('prefers the replica (false) outside of any request context', () => {
    // No enterReadWriteContext call at all on this synchronous call stack —
    // apps/workers/scripts/plain createDatabase usage all land here.
    expect(shouldPreferPrimary()).toBe(false)
    expect(didWriteDuringRequest()).toBe(false)
  })

  it('prefers the primary for the rest of the request when it started with the cookie', async () => {
    await runAsRequest(async () => {
      enterReadWriteContext(true)
      expect(shouldPreferPrimary()).toBe(true)
      await Promise.resolve() // survives a real async gap, not just the synchronous call
      expect(shouldPreferPrimary()).toBe(true)
    })
  })

  it('prefers the replica when the request started without the cookie and has not written yet', async () => {
    await runAsRequest(async () => {
      enterReadWriteContext(false)
      expect(shouldPreferPrimary()).toBe(false)
    })
  })

  it('switches to the primary mid-request the moment a write happens, even without the cookie', async () => {
    await runAsRequest(async () => {
      enterReadWriteContext(false)
      expect(shouldPreferPrimary()).toBe(false)

      markWroteDuringRequest()

      expect(shouldPreferPrimary()).toBe(true)
    })
  })

  it('reports didWriteDuringRequest only after an actual write, not from the incoming cookie alone', async () => {
    await runAsRequest(async () => {
      enterReadWriteContext(true) // request already reading from primary via a still-valid cookie
      expect(didWriteDuringRequest()).toBe(false) // but it hasn't written anything itself yet

      markWroteDuringRequest()
      expect(didWriteDuringRequest()).toBe(true)
    })
  })

  it('never leaks one request into a concurrent, unrelated one', async () => {
    const writer = runAsRequest(async () => {
      enterReadWriteContext(false)
      await new Promise((resolve) => setTimeout(resolve, 10))
      markWroteDuringRequest()
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { preferPrimary: shouldPreferPrimary(), wrote: didWriteDuringRequest() }
    })

    const reader = runAsRequest(async () => {
      enterReadWriteContext(false)
      await new Promise((resolve) => setTimeout(resolve, 15)) // overlaps the writer's own write in the middle of its own window
      return { preferPrimary: shouldPreferPrimary(), wrote: didWriteDuringRequest() }
    })

    const [writerResult, readerResult] = await Promise.all([writer, reader])
    expect(writerResult).toEqual({ preferPrimary: true, wrote: true })
    // The reader's own request never wrote — the writer's concurrent write
    // must not have flipped the reader's independent context.
    expect(readerResult).toEqual({ preferPrimary: false, wrote: false })
  })

  it("a later request does not inherit an earlier one's write flag", async () => {
    await runAsRequest(async () => {
      enterReadWriteContext(false)
      markWroteDuringRequest()
      expect(didWriteDuringRequest()).toBe(true)
    })

    await runAsRequest(async () => {
      enterReadWriteContext(false)
      expect(shouldPreferPrimary()).toBe(false)
      expect(didWriteDuringRequest()).toBe(false)
    })
  })
})
