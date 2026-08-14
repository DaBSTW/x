export type ConversationMembershipLookup = {
  isMember(conversationId: bigint, userId: bigint): Promise<boolean>
}

export type ChannelAuthorizationDeps = {
  conversationMembership: ConversationMembershipLookup
}

/**
 * Whether `userId` may poll `channel` — identical rule set to
 * apps/ws-gateway's own `channel-authorization.ts` (SPECS.md §8.2), and
 * deliberately duplicated rather than imported: apps/* never import each
 * other (CODESTYLE.md §7), the same reasoning already documented on this
 * app's own `realtime.repository.ts`. The two copies are small, pure, and
 * have nothing to drift — a test on each side pins the same four prefixes
 * independently.
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
