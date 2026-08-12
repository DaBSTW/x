import { describe, expect, it } from 'vitest'
import { createConnectionRegistry } from './connection-registry.js'

describe('createConnectionRegistry', () => {
  it('reports a new channel only on its first subscriber', () => {
    const registry = createConnectionRegistry()

    expect(registry.subscribe('conn-1', 'user:123').isNewChannel).toBe(true)
    expect(registry.subscribe('conn-2', 'user:123').isNewChannel).toBe(false)
  })

  it('tracks which connections are subscribed to a channel', () => {
    const registry = createConnectionRegistry()
    registry.subscribe('conn-1', 'user:123')
    registry.subscribe('conn-2', 'user:123')

    expect(registry.connectionsFor('user:123')).toEqual(new Set(['conn-1', 'conn-2']))
    expect(registry.connectionsFor('user:999')).toEqual(new Set())
  })

  it('tracks which channels a connection is subscribed to', () => {
    const registry = createConnectionRegistry()
    registry.subscribe('conn-1', 'user:123')
    registry.subscribe('conn-1', 'timeline:123')

    expect(registry.channelsFor('conn-1')).toEqual(new Set(['user:123', 'timeline:123']))
  })

  it('reports a channel empty only once its last subscriber leaves', () => {
    const registry = createConnectionRegistry()
    registry.subscribe('conn-1', 'user:123')
    registry.subscribe('conn-2', 'user:123')

    expect(registry.unsubscribe('conn-1', 'user:123').isChannelEmpty).toBe(false)
    expect(registry.unsubscribe('conn-2', 'user:123').isChannelEmpty).toBe(true)
    expect(registry.connectionsFor('user:123')).toEqual(new Set())
  })

  it('unsubscribing a channel the connection was never on is a harmless no-op', () => {
    const registry = createConnectionRegistry()
    expect(registry.unsubscribe('conn-1', 'user:123').isChannelEmpty).toBe(false)
  })

  it('re-subscribing to the same channel is idempotent, not a duplicate', () => {
    const registry = createConnectionRegistry()
    registry.subscribe('conn-1', 'user:123')
    registry.subscribe('conn-1', 'user:123')

    expect(registry.connectionsFor('user:123').size).toBe(1)
  })

  it('unsubscribeAll tears down every channel a connection was on and reports emptiness per channel', () => {
    const registry = createConnectionRegistry()
    registry.subscribe('conn-1', 'user:123')
    registry.subscribe('conn-1', 'timeline:123')
    registry.subscribe('conn-2', 'timeline:123') // still has a subscriber after conn-1 leaves

    const result = registry.unsubscribeAll('conn-1')
    expect(result).toHaveLength(2)
    expect(result).toContainEqual({ channel: 'user:123', isChannelEmpty: true })
    expect(result).toContainEqual({ channel: 'timeline:123', isChannelEmpty: false })

    expect(registry.channelsFor('conn-1')).toEqual(new Set())
    expect(registry.connectionsFor('timeline:123')).toEqual(new Set(['conn-2']))
  })

  it('unsubscribeAll on an unknown connection is a harmless no-op', () => {
    const registry = createConnectionRegistry()
    expect(registry.unsubscribeAll('never-connected')).toEqual([])
  })
})
