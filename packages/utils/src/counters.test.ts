import { describe, expect, it } from 'vitest'
import { parseCounterHash, postCountersKey, zeroCounterValues } from './counters.js'

describe('postCountersKey', () => {
  it('formats a key from a string or bigint id the same way', () => {
    expect(postCountersKey('123')).toBe('post:123:counters')
    expect(postCountersKey(123n)).toBe('post:123:counters')
  })
})

describe('zeroCounterValues', () => {
  it('returns every field at zero', () => {
    expect(zeroCounterValues()).toEqual({
      likes: 0,
      reposts: 0,
      replies: 0,
      quotes: 0,
      bookmarks: 0,
    })
  })
})

describe('parseCounterHash', () => {
  it('converts an HGETALL result to numbers', () => {
    expect(
      parseCounterHash({ likes: '3', reposts: '1', replies: '0', quotes: '0', bookmarks: '2' }),
    ).toEqual({
      likes: 3,
      reposts: 1,
      replies: 0,
      quotes: 0,
      bookmarks: 2,
    })
  })

  it('defaults a missing field to zero rather than NaN', () => {
    expect(parseCounterHash({ likes: '5' })).toEqual({
      likes: 5,
      reposts: 0,
      replies: 0,
      quotes: 0,
      bookmarks: 0,
    })
  })
})
