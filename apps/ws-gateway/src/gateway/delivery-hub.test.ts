import { EventEmitter } from 'node:events'
import type { FastifyBaseLogger } from 'fastify'
import type { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'
import { createConnectionRegistry } from './connection-registry.js'
import { createDeliveryHub } from './delivery-hub.js'

function createFakeSubscriber(): Pick<Redis, 'on'> & {
  emitMessage: (channel: string, raw: string) => void
} {
  const emitter = new EventEmitter()
  return {
    on: (...args: Parameters<EventEmitter['on']>) => {
      emitter.on(...args)
      return emitter as unknown as Redis
    },
    emitMessage: (channel: string, raw: string) => emitter.emit('message', channel, raw),
  }
}

function createFakeLogger(): FastifyBaseLogger {
  return { warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger
}

function eventPayload(eventId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ op: 'event', channel: 'user:1', eventId, ...extra })
}

describe('createDeliveryHub', () => {
  it('delivers a pub/sub message to every connection registered for that channel', () => {
    const registry = createConnectionRegistry()
    const subscriber = createFakeSubscriber()
    const hub = createDeliveryHub({ registry, subscriber, logger: createFakeLogger() })

    const sinkA = vi.fn()
    const sinkB = vi.fn()
    hub.register('conn-a', sinkA)
    hub.register('conn-b', sinkB)
    registry.subscribe('conn-a', 'user:1')
    registry.subscribe('conn-b', 'user:1')

    const raw = eventPayload('1000-0')
    subscriber.emitMessage('user:1', raw)

    expect(sinkA).toHaveBeenCalledTimes(1)
    expect(sinkA).toHaveBeenCalledWith(raw, '1000-0')
    expect(sinkB).toHaveBeenCalledTimes(1)
    expect(sinkB).toHaveBeenCalledWith(raw, '1000-0')
  })

  it('never delivers to a connection subscribed to a different channel', () => {
    const registry = createConnectionRegistry()
    const subscriber = createFakeSubscriber()
    const hub = createDeliveryHub({ registry, subscriber, logger: createFakeLogger() })

    const sink = vi.fn()
    hub.register('conn-a', sink)
    registry.subscribe('conn-a', 'user:1')

    subscriber.emitMessage('user:2', eventPayload('1000-0'))
    expect(sink).not.toHaveBeenCalled()
  })

  it('drops a pub/sub message that is not valid JSON, without throwing', () => {
    const registry = createConnectionRegistry()
    const subscriber = createFakeSubscriber()
    const logger = createFakeLogger()
    const hub = createDeliveryHub({ registry, subscriber, logger })

    const sink = vi.fn()
    hub.register('conn-a', sink)
    registry.subscribe('conn-a', 'user:1')

    expect(() => subscriber.emitMessage('user:1', 'not json')).not.toThrow()
    expect(sink).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('drops a pub/sub message with no eventId', () => {
    const registry = createConnectionRegistry()
    const subscriber = createFakeSubscriber()
    const logger = createFakeLogger()
    const hub = createDeliveryHub({ registry, subscriber, logger })

    const sink = vi.fn()
    hub.register('conn-a', sink)
    registry.subscribe('conn-a', 'user:1')

    subscriber.emitMessage('user:1', JSON.stringify({ op: 'event', channel: 'user:1' }))
    expect(sink).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('deliverEvent on a connection with no registered sink is a harmless no-op', () => {
    const registry = createConnectionRegistry()
    const subscriber = createFakeSubscriber()
    const hub = createDeliveryHub({ registry, subscriber, logger: createFakeLogger() })

    expect(() => hub.deliverEvent('never-registered', 'user:1', '1000-0', '{}')).not.toThrow()
  })

  it('unregister stops further delivery to that connection', () => {
    const registry = createConnectionRegistry()
    const subscriber = createFakeSubscriber()
    const hub = createDeliveryHub({ registry, subscriber, logger: createFakeLogger() })

    const sink = vi.fn()
    hub.register('conn-a', sink)
    registry.subscribe('conn-a', 'user:1')
    hub.unregister('conn-a')

    subscriber.emitMessage('user:1', eventPayload('1000-0'))
    expect(sink).not.toHaveBeenCalled()
  })

  describe('dedup guard', () => {
    it('never delivers the same eventId twice to the same connection on the same channel', () => {
      const registry = createConnectionRegistry()
      const subscriber = createFakeSubscriber()
      const hub = createDeliveryHub({ registry, subscriber, logger: createFakeLogger() })

      const sink = vi.fn()
      hub.register('conn-a', sink)
      registry.subscribe('conn-a', 'user:1')

      // A replayed entry delivered directly (as gateway.plugin.ts's/
      // sse.plugin.ts's own post-subscribe replay loop does)...
      hub.deliverEvent('conn-a', 'user:1', '1000-0', eventPayload('1000-0'))
      // ...then the *same* event arriving live via PUBLISH, the exact
      // overlap window subscription-handler.ts's own comment describes
      // (Redis SUBSCRIBE happens before replay finishes).
      subscriber.emitMessage('user:1', eventPayload('1000-0'))

      expect(sink).toHaveBeenCalledTimes(1)
    })

    it('still delivers a genuinely newer event after an older one', () => {
      const registry = createConnectionRegistry()
      const subscriber = createFakeSubscriber()
      const hub = createDeliveryHub({ registry, subscriber, logger: createFakeLogger() })

      const sink = vi.fn()
      hub.register('conn-a', sink)
      registry.subscribe('conn-a', 'user:1')

      hub.deliverEvent('conn-a', 'user:1', '1000-0', eventPayload('1000-0'))
      hub.deliverEvent('conn-a', 'user:1', '2000-0', eventPayload('2000-0'))

      expect(sink).toHaveBeenCalledTimes(2)
    })

    it('tracks the dedup cursor independently per channel', () => {
      const registry = createConnectionRegistry()
      const subscriber = createFakeSubscriber()
      const hub = createDeliveryHub({ registry, subscriber, logger: createFakeLogger() })

      const sink = vi.fn()
      hub.register('conn-a', sink)
      registry.subscribe('conn-a', 'user:1')
      registry.subscribe('conn-a', 'timeline:1')

      hub.deliverEvent('conn-a', 'user:1', '5000-0', eventPayload('5000-0'))
      // A lower stream id, but on a different channel — not a duplicate.
      hub.deliverEvent('conn-a', 'timeline:1', '1000-0', eventPayload('1000-0'))

      expect(sink).toHaveBeenCalledTimes(2)
    })

    it("clears a connection's dedup state on unregister — a fresh connection id never inherits a stale cursor", () => {
      const registry = createConnectionRegistry()
      const subscriber = createFakeSubscriber()
      const hub = createDeliveryHub({ registry, subscriber, logger: createFakeLogger() })

      const sink = vi.fn()
      hub.register('conn-a', sink)
      registry.subscribe('conn-a', 'user:1')
      hub.deliverEvent('conn-a', 'user:1', '5000-0', eventPayload('5000-0'))
      hub.unregister('conn-a')

      // Same connectionId reused (e.g. a counter wrapping in a long-running
      // process) — re-registering must not still think '5000-0' was seen.
      hub.register('conn-a', sink)
      hub.deliverEvent('conn-a', 'user:1', '1000-0', eventPayload('1000-0'))

      expect(sink).toHaveBeenCalledTimes(2)
    })
  })
})
