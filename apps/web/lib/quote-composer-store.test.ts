import type { Post } from '@x/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { useQuoteComposerStore } from './quote-composer-store.js'

function makePost(id: string): Post {
  return {
    id,
    text: 'hola',
    createdAt: '2026-08-11T00:00:00Z',
    author: { id: '1', username: 'ana', displayName: 'Ana', avatarUrl: null, isVerified: false },
    entities: [],
    media: [],
    conversationId: id,
    inReplyToId: null,
    counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
    quotedPost: null,
  }
}

describe('useQuoteComposerStore', () => {
  afterEach(() => {
    useQuoteComposerStore.setState({ quotedPost: null })
  })

  it('defaults to closed (no quoted post)', () => {
    expect(useQuoteComposerStore.getState().quotedPost).toBeNull()
  })

  it('open(post) sets the quoted post', () => {
    const post = makePost('123')
    useQuoteComposerStore.getState().open(post)
    expect(useQuoteComposerStore.getState().quotedPost).toEqual(post)
  })

  it('close() clears the quoted post', () => {
    useQuoteComposerStore.getState().open(makePost('123'))
    useQuoteComposerStore.getState().close()
    expect(useQuoteComposerStore.getState().quotedPost).toBeNull()
  })
})
