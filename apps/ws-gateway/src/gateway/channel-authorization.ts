export type ConversationMembershipLookup = {
  isMember(conversationId: bigint, userId: bigint): Promise<boolean>
}

export type ChannelAuthorizationDeps = {
  conversationMembership: ConversationMembershipLookup
}

/**
 * Whether `userId` may subscribe to `channel` — SPECS.md §8.2's four
 * prefixes, each with its own rule:
 *  - `user:{id}` / `timeline:{id}` — only your own (a timeline's "N posts
 *    nuevos" badge and a user's own notifications are never someone else's
 *    to watch).
 *  - `conv:{id}` — only an actual member, checked against Postgres (a DM
 *    thread's existence is itself private, ROADMAP.md 2.5).
 *  - `post:{id}` — any authenticated connection. Counter updates aren't
 *    sensitive, and this bullet never asked for block/private-post
 *    enforcement here — that already happens on the REST reads themselves
 *    (ROADMAP.md 2.6); re-deriving it per subscribe would be a real cost
 *    for a channel that only ever carries a number going up.
 *
 * Malformed input (unknown prefix, non-numeric id) is rejected the same as
 * an unauthorized one — the caller doesn't need to distinguish "wrong
 * shape" from "not yours" (`realtimeChannelSchema` in `@x/contracts`
 * already rejects malformed channels before this ever runs, so this is
 * belt-and-suspenders, not the only line of defense).
 */
export async function authorizeChannel(
  channel: string,
  userId: bigint,
  deps: ChannelAuthorizationDeps,
): Promise<boolean> {
  const separatorIndex = channel.indexOf(':')
  if (separatorIndex === -1) return false
  const prefix = channel.slice(0, separatorIndex)
  const rawId = channel.slice(separatorIndex + 1)

  let entityId: bigint
  try {
    entityId = BigInt(rawId)
  } catch {
    return false
  }
  if (entityId < 0n) return false

  switch (prefix) {
    case 'user':
    case 'timeline':
      return entityId === userId
    case 'post':
      return true
    case 'conv':
      return deps.conversationMembership.isMember(entityId, userId)
    default:
      return false
  }
}
