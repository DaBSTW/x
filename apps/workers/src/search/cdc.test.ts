import { cdcTopicName } from '@x/utils'
import { describe, expect, it } from 'vitest'
import { CDC_TOPICS, parseCdcMessage } from './cdc.js'

function buffer(value: string): Buffer {
  return Buffer.from(value, 'utf8')
}

describe('CDC_TOPICS', () => {
  it('lists exactly the five watched tables, each exactly once', () => {
    expect(CDC_TOPICS.sort()).toEqual(
      [
        cdcTopicName('posts'),
        cdcTopicName('users'),
        cdcTopicName('post_counters'),
        cdcTopicName('user_counters'),
        cdcTopicName('media'),
      ].sort(),
    )
  })
})

describe('parseCdcMessage', () => {
  it('extracts a post id from a posts-topic message', () => {
    const parsed = parseCdcMessage(
      cdcTopicName('posts'),
      buffer('{"id":123,"author_id":456,"text":"hola"}'),
    )
    expect(parsed).toEqual({ entity: 'post', id: 123n })
  })

  it('extracts a user id from a users-topic message', () => {
    const parsed = parseCdcMessage(cdcTopicName('users'), buffer('{"id":789,"username":"ana"}'))
    expect(parsed).toEqual({ entity: 'user', id: 789n })
  })

  it("reads post_counters/media by post_id and user_counters by user_id — the parent row's id, not their own primary key", () => {
    expect(
      parseCdcMessage(cdcTopicName('post_counters'), buffer('{"post_id":11,"likes_count":3}')),
    ).toEqual({ entity: 'post', id: 11n })
    expect(
      parseCdcMessage(cdcTopicName('media'), buffer('{"id":99,"post_id":22,"owner_id":5}')),
    ).toEqual({ entity: 'post', id: 22n })
    expect(
      parseCdcMessage(cdcTopicName('user_counters'), buffer('{"user_id":33,"followers_count":9}')),
    ).toEqual({ entity: 'user', id: 33n })
  })

  // The entire reason this module exists instead of a plain JSON.parse call:
  // a snowflake id routinely exceeds Number.MAX_SAFE_INTEGER (2^53 - 1).
  // Debezium's JSON converter serializes Postgres bigint columns as plain
  // JSON numbers, and JSON.parse would silently round this to the nearest
  // representable double — a different, wrong id, not a crash. Picking a
  // *different* real post by accident is worse than throwing.
  it('preserves full snowflake-id precision beyond Number.MAX_SAFE_INTEGER', () => {
    const hugeId = '9223372036854775001' // within int64 range, well past 2^53
    // Sanity check that this id actually exercises the bug this test exists
    // for: plain Number() conversion already rounds it to a different value.
    expect(String(Number(hugeId))).not.toBe(hugeId)

    const parsed = parseCdcMessage(cdcTopicName('posts'), buffer(`{"id":${hugeId},"author_id":1}`))
    expect(parsed?.id).toBe(BigInt(hugeId))
    expect(parsed?.id.toString()).toBe(hugeId)
  })

  it('is unaffected by a large integer appearing inside a quoted string value elsewhere in the payload', () => {
    // A post whose *text* happens to contain something that looks like a
    // JSON key — a naive regex-based extractor could misfire on this;
    // a real JSON parser (json-bigint included) never does, because it
    // respects string quoting.
    const parsed = parseCdcMessage(
      cdcTopicName('posts'),
      buffer('{"id":5,"author_id":1,"text":"mi post_id favorito es 999999999999999999"}'),
    )
    expect(parsed).toEqual({ entity: 'post', id: 5n })
  })

  it('returns null for a topic it does not recognize', () => {
    expect(parseCdcMessage('x.public.sessions', buffer('{"id":1}'))).toBeNull()
  })

  it('returns null for a null value (the native tombstone Kafka Connect emits after a rewritten delete)', () => {
    expect(parseCdcMessage(cdcTopicName('posts'), null)).toBeNull()
  })

  it('returns null when the id field is absent (e.g. an unlinked media row, post_id still null)', () => {
    expect(parseCdcMessage(cdcTopicName('media'), buffer('{"id":1,"post_id":null}'))).toBeNull()
  })
})
