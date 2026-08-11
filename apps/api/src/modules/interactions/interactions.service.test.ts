import type { Post } from '@x/contracts'
import type { Post as DbPost, PostCounters } from '@x/db'
import { generateId } from '@x/utils'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it } from 'vitest'
import type { InteractionsRepository } from './interactions.repository.js'
import { createInteractionsService } from './interactions.service.js'

// Hand-rolled — models only the hash/set operations post-counters-cache.ts
// actually issues (HGETALL, HSETNX, HINCRBY, SADD, EXISTS), matching the
// fake-Redis convention used across this codebase's other service tests.
function createFakeRedis(): Redis {
  const hashes = new Map<string, Map<string, string>>()

  function hgetallSync(key: string): Record<string, string> {
    const hash = hashes.get(key)
    return hash ? Object.fromEntries(hash) : {}
  }

  return {
    async exists(key: string) {
      return hashes.has(key) ? 1 : 0
    },
    async hgetall(key: string) {
      return hgetallSync(key)
    },
    pipeline() {
      const ops: Array<() => void> = []
      const api = {
        hsetnx(key: string, field: string, value: unknown) {
          ops.push(() => {
            const hash = hashes.get(key) ?? new Map<string, string>()
            if (!hash.has(field)) hash.set(field, String(value))
            hashes.set(key, hash)
          })
          return api
        },
        async exec() {
          for (const op of ops) op()
          return []
        },
      }
      return api
    },
    multi() {
      const ops: Array<() => void> = []
      const api = {
        hincrby(key: string, field: string, delta: number) {
          ops.push(() => {
            const hash = hashes.get(key) ?? new Map<string, string>()
            hash.set(field, String(Number(hash.get(field) ?? 0) + delta))
            hashes.set(key, hash)
          })
          return api
        },
        sadd() {
          return api
        },
        async exec() {
          for (const op of ops) op()
          return []
        },
      }
      return api
    },
  } as unknown as Redis
}

function createFakeInteractionsRepository(): InteractionsRepository {
  const likes = new Set<string>()
  const bookmarks = new Set<string>()
  const key = (userId: bigint, postId: bigint) => `${userId}:${postId}`

  return {
    async findLike(userId, postId) {
      return likes.has(key(userId, postId))
    },
    async insertLike(userId, postId) {
      likes.add(key(userId, postId))
    },
    async deleteLike(userId, postId) {
      return likes.delete(key(userId, postId))
    },
    async findBookmark(userId, postId) {
      return bookmarks.has(key(userId, postId))
    },
    async insertBookmark(userId, postId) {
      bookmarks.add(key(userId, postId))
    },
    async deleteBookmark(userId, postId) {
      return bookmarks.delete(key(userId, postId))
    },
    async findLikedPostIds(userId, postIds) {
      return new Set(postIds.filter((postId) => likes.has(key(userId, postId))))
    },
    async findBookmarkedPostIds(userId, postIds) {
      return new Set(postIds.filter((postId) => bookmarks.has(key(userId, postId))))
    },
    async listBookmarkedPostIds(userId, limit, cursor) {
      const prefix = `${userId}:`
      return [...bookmarks]
        .filter((entry) => entry.startsWith(prefix))
        .map((entry) => BigInt(entry.slice(prefix.length)))
        .filter((postId) => cursor === null || postId < cursor)
        .sort((a, b) => (b > a ? 1 : -1))
        .slice(0, limit)
    },
  }
}

function makeCounters(postId: bigint): PostCounters {
  return {
    postId,
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    quotesCount: 0,
    bookmarkCount: 0,
    viewsCount: 0n,
  }
}

describe('createInteractionsService', () => {
  let redis: Redis
  let interactionsRepository: InteractionsRepository
  let postId: bigint
  let userId: bigint
  let postAuthorId: bigint

  beforeEach(() => {
    redis = createFakeRedis()
    interactionsRepository = createFakeInteractionsRepository()
    postId = generateId()
    userId = generateId()
    postAuthorId = generateId()
  })

  function createService(
    overrides: { postExists?: boolean } = {},
    publishNotification?: (data: unknown) => Promise<void>,
  ) {
    const postsRepository = {
      async findPostById() {
        return overrides.postExists === false
          ? null
          : ({ id: postId, authorId: postAuthorId } as DbPost)
      },
      async findPostCounters() {
        return makeCounters(postId)
      },
    }
    const postsService = {
      repost: async (): Promise<Post> => ({
        id: generateId().toString(),
        text: null,
        createdAt: new Date().toISOString(),
        author: {
          id: userId.toString(),
          username: 'bob',
          displayName: 'Bob',
          avatarUrl: null,
          isVerified: false,
        },
        entities: [],
        media: [],
        conversationId: postId.toString(),
        inReplyToId: null,
        counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
      }),
      unrepost: async () => true,
    }
    return createInteractionsService(
      interactionsRepository,
      postsRepository,
      postsService,
      redis,
      publishNotification,
    )
  }

  describe('like / unlike', () => {
    it('records a like and seeds+bumps the Redis counter from zero', async () => {
      const service = createService()

      await service.like(userId, postId)

      expect(await redis.hgetall(`post:${postId}:counters`)).toMatchObject({ likes: '1' })
    })

    it('rejects liking the same post twice', async () => {
      const service = createService()
      await service.like(userId, postId)

      await expect(service.like(userId, postId)).rejects.toMatchObject({ code: 'CONFLICT' })
    })

    it('throws NotFoundError when the post does not exist', async () => {
      const service = createService({ postExists: false })
      await expect(service.like(userId, postId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('decrements the counter on unlike, and is a no-op if never liked', async () => {
      const service = createService()
      await service.like(userId, postId)

      await service.unlike(userId, postId)
      expect(await redis.hgetall(`post:${postId}:counters`)).toMatchObject({ likes: '0' })

      await service.unlike(userId, postId) // already gone — must not go negative
      expect(await redis.hgetall(`post:${postId}:counters`)).toMatchObject({ likes: '0' })
    })

    it('publishes a like notification to the post author', async () => {
      const published: unknown[] = []
      const service = createService({}, async (data) => {
        published.push(data)
      })

      await service.like(userId, postId)

      expect(published).toEqual([
        {
          userId: postAuthorId.toString(),
          kind: 'like',
          actorId: userId.toString(),
          postId: postId.toString(),
          groupKey: `like:${postId}`,
        },
      ])
    })

    it('does not notify when liking your own post', async () => {
      const published: unknown[] = []
      const service = createService({}, async (data) => {
        published.push(data)
      })

      await service.like(postAuthorId, postId)

      expect(published).toEqual([])
    })
  })

  describe('bookmark / unbookmark', () => {
    it('records a bookmark and bumps the counter', async () => {
      const service = createService()
      await service.bookmark(userId, postId)
      expect(await redis.hgetall(`post:${postId}:counters`)).toMatchObject({ bookmarks: '1' })
    })

    it('rejects bookmarking the same post twice', async () => {
      const service = createService()
      await service.bookmark(userId, postId)
      await expect(service.bookmark(userId, postId)).rejects.toMatchObject({ code: 'CONFLICT' })
    })
  })

  describe('repost / unrepost', () => {
    it('delegates to postsService and bumps the reposts counter', async () => {
      const service = createService()
      await service.repost(userId, postId)
      expect(await redis.hgetall(`post:${postId}:counters`)).toMatchObject({ reposts: '1' })
    })

    it('decrements the counter on unrepost', async () => {
      const service = createService()
      await service.repost(userId, postId)
      await service.unrepost(userId, postId)
      expect(await redis.hgetall(`post:${postId}:counters`)).toMatchObject({ reposts: '0' })
    })
  })
})
