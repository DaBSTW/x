import { describe, expect, it } from 'vitest'
import { type ConversationMembershipLookup, authorizeChannel } from './channel-authorization.js'

function createFakeMembership(members: Set<string>): ConversationMembershipLookup {
  return {
    async isMember(conversationId, userId) {
      return members.has(`${conversationId}:${userId}`)
    },
  }
}

describe('authorizeChannel', () => {
  it('allows a user to subscribe to their own user: channel', async () => {
    const deps = { conversationMembership: createFakeMembership(new Set()) }
    expect(await authorizeChannel('user:123', 123n, deps)).toBe(true)
  })

  it("rejects subscribing to someone else's user: channel", async () => {
    const deps = { conversationMembership: createFakeMembership(new Set()) }
    expect(await authorizeChannel('user:123', 456n, deps)).toBe(false)
  })

  it('allows a user to subscribe to their own timeline: channel only', async () => {
    const deps = { conversationMembership: createFakeMembership(new Set()) }
    expect(await authorizeChannel('timeline:123', 123n, deps)).toBe(true)
    expect(await authorizeChannel('timeline:123', 456n, deps)).toBe(false)
  })

  it('allows any authenticated connection to subscribe to a post: channel', async () => {
    const deps = { conversationMembership: createFakeMembership(new Set()) }
    expect(await authorizeChannel('post:999', 123n, deps)).toBe(true)
    expect(await authorizeChannel('post:999', 456n, deps)).toBe(true)
  })

  it('allows a conv: channel only for an actual member, per the injected lookup', async () => {
    const deps = { conversationMembership: createFakeMembership(new Set(['555:123'])) }
    expect(await authorizeChannel('conv:555', 123n, deps)).toBe(true)
    expect(await authorizeChannel('conv:555', 456n, deps)).toBe(false)
  })

  it('rejects an unrecognized channel prefix', async () => {
    const deps = { conversationMembership: createFakeMembership(new Set()) }
    expect(await authorizeChannel('admin:123', 123n, deps)).toBe(false)
  })

  it('rejects a channel with no separator', async () => {
    const deps = { conversationMembership: createFakeMembership(new Set()) }
    expect(await authorizeChannel('user123', 123n, deps)).toBe(false)
  })

  it('rejects a non-numeric id', async () => {
    const deps = { conversationMembership: createFakeMembership(new Set()) }
    expect(await authorizeChannel('user:abc', 123n, deps)).toBe(false)
  })

  it('rejects a negative id', async () => {
    const deps = { conversationMembership: createFakeMembership(new Set()) }
    expect(await authorizeChannel('user:-1', -1n, deps)).toBe(false)
  })
})
