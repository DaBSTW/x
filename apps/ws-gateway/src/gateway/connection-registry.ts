export type SubscribeResult = {
  /**
   * True the first time *any* connection on this process subscribes to this
   * channel — the caller must issue a real Redis `SUBSCRIBE` for it
   * (SPECS.md §8.3's "cada instancia mantiene un mapa `channel → Set<connection>`").
   */
  isNewChannel: boolean
}

export type UnsubscribeResult = {
  /** True once no connection on this process is subscribed to this channel anymore — the caller must Redis `UNSUBSCRIBE`, or the process leaks one subscription per channel ever touched. */
  isChannelEmpty: boolean
}

export type ConnectionRegistry = ReturnType<typeof createConnectionRegistry>

/**
 * In-process bookkeeping of which connections care about which channels —
 * SPECS.md §8.3. Pure and dependency-free on purpose: the actual socket and
 * Redis pub/sub plumbing (gateway.plugin.ts) reacts to what this returns,
 * but this class itself has no idea either one exists, so it's unit
 * testable without a network or a container.
 */
export function createConnectionRegistry() {
  const connectionsByChannel = new Map<string, Set<string>>()
  const channelsByConnection = new Map<string, Set<string>>()

  return {
    subscribe(connectionId: string, channel: string): SubscribeResult {
      let connections = connectionsByChannel.get(channel)
      const isNewChannel = connections === undefined
      if (connections === undefined) {
        connections = new Set()
        connectionsByChannel.set(channel, connections)
      }
      connections.add(connectionId)

      let channels = channelsByConnection.get(connectionId)
      if (channels === undefined) {
        channels = new Set()
        channelsByConnection.set(connectionId, channels)
      }
      channels.add(channel)

      return { isNewChannel }
    },

    unsubscribe(connectionId: string, channel: string): UnsubscribeResult {
      const connections = connectionsByChannel.get(channel)
      connections?.delete(connectionId)
      channelsByConnection.get(connectionId)?.delete(channel)

      const isChannelEmpty = connections !== undefined && connections.size === 0
      if (isChannelEmpty) connectionsByChannel.delete(channel)

      return { isChannelEmpty }
    },

    /** Called once, on disconnect — every channel this connection ever subscribed to, each paired with whether it's now empty (needs a Redis UNSUBSCRIBE). */
    unsubscribeAll(connectionId: string): Array<{ channel: string; isChannelEmpty: boolean }> {
      const channels = channelsByConnection.get(connectionId)
      channelsByConnection.delete(connectionId)
      if (!channels) return []

      return [...channels].map((channel) => {
        const connections = connectionsByChannel.get(channel)
        connections?.delete(connectionId)
        const isChannelEmpty = connections !== undefined && connections.size === 0
        if (isChannelEmpty) connectionsByChannel.delete(channel)
        return { channel, isChannelEmpty }
      })
    },

    /** Connection ids currently subscribed to `channel` — who a published event fans out to. */
    connectionsFor(channel: string): ReadonlySet<string> {
      return connectionsByChannel.get(channel) ?? new Set()
    },

    /** Channels `connectionId` is currently subscribed to. */
    channelsFor(connectionId: string): ReadonlySet<string> {
      return channelsByConnection.get(connectionId) ?? new Set()
    },
  }
}
