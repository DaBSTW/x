import { describe, expect, it } from 'vitest'
import { CDC_TOPIC_PREFIX, POSTS_SEARCH_INDEX, USERS_SEARCH_INDEX, cdcTopicName } from './search.js'

describe('search index names', () => {
  it('are distinct, stable strings', () => {
    expect(POSTS_SEARCH_INDEX).toBe('posts')
    expect(USERS_SEARCH_INDEX).toBe('users')
    expect(POSTS_SEARCH_INDEX).not.toBe(USERS_SEARCH_INDEX)
  })
})

describe('cdcTopicName', () => {
  it('matches Debezium’s own {prefix}.{schema}.{table} convention', () => {
    expect(cdcTopicName('posts')).toBe(`${CDC_TOPIC_PREFIX}.public.posts`)
    expect(cdcTopicName('users')).toBe(`${CDC_TOPIC_PREFIX}.public.users`)
    expect(cdcTopicName('post_counters')).toBe(`${CDC_TOPIC_PREFIX}.public.post_counters`)
    expect(cdcTopicName('user_counters')).toBe(`${CDC_TOPIC_PREFIX}.public.user_counters`)
    expect(cdcTopicName('media')).toBe(`${CDC_TOPIC_PREFIX}.public.media`)
  })
})
