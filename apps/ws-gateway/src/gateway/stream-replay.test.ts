import { realtimeStreamKey } from '@x/utils'
import type { Redis } from 'ioredis'
import { describe, expect, it } from 'vitest'
import { replayMissedEvents } from './stream-replay.js'

// Hand-rolled — models only xrange, the one command this function issues.
function createFakeRedis(entries: Array<[string, string[]]>): Pick<Redis, 'xrange'> {
  return {
    xrange: (async (
      _key: string,
      start: string,
      _end: string,
      _countToken: string,
      count: number,
    ) => {
      const sinceId = start.startsWith('(') ? start.slice(1) : start
      return entries.filter(([id]) => id > sinceId).slice(0, count)
    }) as Redis['xrange'],
  }
}

describe('replayMissedEvents', () => {
  it('reconstructs the same envelope shape a live PUBLISH sends', async () => {
    const redis = createFakeRedis([
      ['100-0', ['event', 'post.available', 'data', JSON.stringify({ postId: '1' })]],
    ])

    const result = await replayMissedEvents(redis, 'timeline:1', '0-0')

    expect(result).toEqual([
      {
        id: '100-0',
        raw: JSON.stringify({
          op: 'event',
          channel: 'timeline:1',
          event: 'post.available',
          data: { postId: '1' },
          eventId: '100-0',
        }),
      },
    ])
  })

  it('excludes the since id itself and everything at or before it', async () => {
    const redis = createFakeRedis([
      ['100-0', ['event', 'post.available', 'data', '{}']],
      ['200-0', ['event', 'post.available', 'data', '{}']],
      ['300-0', ['event', 'post.available', 'data', '{}']],
    ])

    const result = await replayMissedEvents(redis, 'timeline:1', '200-0')

    expect(result.map((event) => event.id)).toEqual(['300-0'])
  })

  it('returns everything when since is the beginning of the stream', async () => {
    const redis = createFakeRedis([
      ['100-0', ['event', 'post.available', 'data', '{}']],
      ['200-0', ['event', 'post.available', 'data', '{}']],
    ])

    const result = await replayMissedEvents(redis, 'timeline:1', '0-0')

    expect(result.map((event) => event.id)).toEqual(['100-0', '200-0'])
  })

  it('returns an empty array when the stream has nothing newer', async () => {
    const redis = createFakeRedis([['100-0', ['event', 'post.available', 'data', '{}']]])

    const result = await replayMissedEvents(redis, 'timeline:1', '100-0')

    expect(result).toEqual([])
  })

  it('reads from the stream key derived from the channel, not the channel name itself', async () => {
    let queriedKey: string | undefined
    const redis: Pick<Redis, 'xrange'> = {
      xrange: (async (key: string) => {
        queriedKey = key
        return []
      }) as Redis['xrange'],
    }

    await replayMissedEvents(redis, 'timeline:42', '0-0')

    expect(queriedKey).toBe(realtimeStreamKey('timeline:42'))
  })
})
