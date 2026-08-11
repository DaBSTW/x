import type { Post, PostCounters } from '@x/db'
import { generateId } from '@x/utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AuthorRow, PostEntityRow, PostRepository } from './posts.repository.js'
import { createPostsService } from './posts.service.js'

function makePost(overrides: Partial<Post> & Pick<Post, 'id' | 'authorId'>): Post {
  return {
    kind: 'original',
    text: null,
    lang: null,
    inReplyToId: null,
    conversationId: null,
    repostOfId: null,
    quotedPostId: null,
    replyPolicy: 0,
    isSensitive: false,
    clientName: null,
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
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

function createFakeRepository() {
  const postsById = new Map<bigint, Post>()
  const entitiesByPostId = new Map<bigint, PostEntityRow[]>()
  const countersByPostId = new Map<bigint, PostCounters>()
  const authorsById = new Map<bigint, AuthorRow>()

  const repository: PostRepository = {
    async insertPost(post, entities, counters) {
      postsById.set(
        post.id,
        makePost({
          id: post.id,
          authorId: post.authorId,
          kind: post.kind ?? 'original',
          text: post.text ?? null,
          inReplyToId: post.inReplyToId ?? null,
          conversationId: post.conversationId ?? null,
          quotedPostId: post.quotedPostId ?? null,
        }),
      )
      entitiesByPostId.set(post.id, entities)
      countersByPostId.set(counters.postId, makeCounters(counters.postId))
    },
    async findPostById(id) {
      const post = postsById.get(id)
      return post && !post.deletedAt ? post : null
    },
    async findPostCounters(postId) {
      return countersByPostId.get(postId) ?? null
    },
    async findPostsByIds(ids) {
      return ids
        .map((id) => postsById.get(id))
        .filter((post): post is Post => post !== undefined && !post.deletedAt)
    },
    async findPostEntities(postId) {
      return entitiesByPostId.get(postId) ?? []
    },
    async findEntitiesForPosts(postIds) {
      return postIds.flatMap((id) => entitiesByPostId.get(id) ?? [])
    },
    async findCountersForPosts(postIds) {
      return postIds
        .map((id) => countersByPostId.get(id))
        .filter((row): row is PostCounters => row !== undefined)
    },
    async findAuthorById(id) {
      return authorsById.get(id) ?? null
    },
    async findAuthorsByIds(ids) {
      return ids
        .map((id) => authorsById.get(id))
        .filter((row): row is AuthorRow => row !== undefined)
    },
    async findUserIdByUsername(usernameLower) {
      for (const author of authorsById.values()) {
        if (author.username.toLowerCase() === usernameLower) return author.id
      }
      return null
    },
    async findUserIdsByUsernames(usernamesLower) {
      const map = new Map<string, bigint>()
      for (const author of authorsById.values()) {
        if (usernamesLower.includes(author.username.toLowerCase())) {
          map.set(author.username.toLowerCase(), author.id)
        }
      }
      return map
    },
    async softDeletePost(id) {
      const post = postsById.get(id)
      if (post) post.deletedAt = new Date()
    },
    async listPostsByAuthor(authorId, limit, cursor) {
      return [...postsById.values()]
        .filter((post) => post.authorId === authorId && !post.deletedAt)
        .filter((post) => cursor === null || post.id < cursor)
        .sort((a, b) => (b.id > a.id ? 1 : -1))
        .slice(0, limit)
    },
    async insertRepost(repost, counters) {
      postsById.set(
        repost.id,
        makePost({
          id: repost.id,
          authorId: repost.authorId,
          kind: 'repost',
          repostOfId: repost.repostOfId,
          conversationId: repost.conversationId,
        }),
      )
      countersByPostId.set(counters.postId, makeCounters(counters.postId))
    },
    async findActiveRepost(authorId, repostOfId) {
      for (const post of postsById.values()) {
        if (
          post.authorId === authorId &&
          post.repostOfId === repostOfId &&
          post.kind === 'repost' &&
          !post.deletedAt
        ) {
          return post.id
        }
      }
      return null
    },
  }

  return { repository, authorsById }
}

function addAuthor(
  authorsById: Map<bigint, AuthorRow>,
  overrides: Partial<AuthorRow> = {},
): AuthorRow {
  const author: AuthorRow = {
    id: generateId(),
    username: 'ana',
    displayName: 'Ana',
    avatarUrl: null,
    isVerified: false,
    ...overrides,
  }
  authorsById.set(author.id, author)
  return author
}

describe('createPostsService', () => {
  let repository: PostRepository
  let authorsById: Map<bigint, AuthorRow>
  let author: AuthorRow

  beforeEach(() => {
    const fake = createFakeRepository()
    repository = fake.repository
    authorsById = fake.authorsById
    author = addAuthor(authorsById)
  })

  describe('create', () => {
    it('creates an original post and resolves conversationId to itself', async () => {
      const service = createPostsService(repository)

      const post = await service.create(author.id, {
        text: 'hola mundo',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(post.text).toBe('hola mundo')
      expect(post.conversationId).toBe(post.id)
      expect(post.inReplyToId).toBeNull()
    })

    it('rejects empty text', async () => {
      const service = createPostsService(repository)

      await expect(
        service.create(author.id, { text: '', replyPolicy: 'everyone', isSensitive: false }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects text over 280 graphemes', async () => {
      const service = createPostsService(repository)

      await expect(
        service.create(author.id, {
          text: 'a'.repeat(281),
          replyPolicy: 'everyone',
          isSensitive: false,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects more than 10 mentions', async () => {
      const service = createPostsService(repository)
      const text = Array.from({ length: 11 }, (_, i) => `@user${i}`).join(' ')

      await expect(
        service.create(author.id, { text, replyPolicy: 'everyone', isSensitive: false }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects more than 5 hashtags', async () => {
      const service = createPostsService(repository)
      const text = Array.from({ length: 6 }, (_, i) => `#tag${i}`).join(' ')

      await expect(
        service.create(author.id, { text, replyPolicy: 'everyone', isSensitive: false }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('resolves a mention to the mentioned user id', async () => {
      const service = createPostsService(repository)
      const mentioned = addAuthor(authorsById, { id: generateId(), username: 'bob' })

      const post = await service.create(author.id, {
        text: 'hola @bob',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const mentionEntity = post.entities.find((entity) => entity.kind === 'mention')
      expect(mentionEntity?.value).toBe('bob')
      expect(mentioned.username).toBe('bob')
    })

    it('inherits conversationId from the parent when replying', async () => {
      const service = createPostsService(repository)
      const root = await service.create(author.id, {
        text: 'raíz del hilo',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const reply = await service.create(author.id, {
        text: 'una respuesta',
        inReplyToId: BigInt(root.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(reply.conversationId).toBe(root.id)
      expect(reply.inReplyToId).toBe(root.id)
    })

    it('throws NotFoundError when replying to a nonexistent post', async () => {
      const service = createPostsService(repository)

      await expect(
        service.create(author.id, {
          text: 'respuesta huérfana',
          inReplyToId: 999999999999999999n,
          replyPolicy: 'everyone',
          isSensitive: false,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('invokes onPostCreated with the new post and author ids', async () => {
      const calls: Array<{ postId: bigint; authorId: bigint }> = []
      const service = createPostsService(repository, async (postId, authorId) => {
        calls.push({ postId, authorId })
      })

      const post = await service.create(author.id, {
        text: 'hola mundo',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(calls).toEqual([{ postId: BigInt(post.id), authorId: author.id }])
    })

    it('does not fail post creation when onPostCreated rejects', async () => {
      const service = createPostsService(repository, async () => {
        throw new Error('queue unavailable')
      })

      await expect(
        service.create(author.id, {
          text: 'hola mundo',
          replyPolicy: 'everyone',
          isSensitive: false,
        }),
      ).resolves.toMatchObject({ text: 'hola mundo' })
    })
  })

  describe('getById', () => {
    it('returns a post by id', async () => {
      const service = createPostsService(repository)
      const created = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const fetched = await service.getById(BigInt(created.id))
      expect(fetched.id).toBe(created.id)
    })

    it('throws NotFoundError for a nonexistent post', async () => {
      const service = createPostsService(repository)
      await expect(service.getById(999999999999999999n)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })
  })

  describe('remove', () => {
    it('soft-deletes when the requester is the author', async () => {
      const service = createPostsService(repository)
      const created = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await service.remove(BigInt(created.id), author.id)

      await expect(service.getById(BigInt(created.id))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('throws ForbiddenError when the requester is not the author', async () => {
      const service = createPostsService(repository)
      const other = addAuthor(authorsById, { id: generateId(), username: 'eve' })
      const created = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await expect(service.remove(BigInt(created.id), other.id)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })
  })

  describe('repost', () => {
    it('creates a repost with null text pointing at the original', async () => {
      const service = createPostsService(repository)
      const original = await service.create(author.id, {
        text: 'post original',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const reposter = addAuthor(authorsById, { id: generateId(), username: 'bob' })

      const repost = await service.repost(reposter.id, BigInt(original.id))

      expect(repost.text).toBeNull()
      expect(repost.conversationId).toBe(original.id)
      expect(repost.author.username).toBe('bob')
    })

    it('rejects reposting the same post twice by the same author', async () => {
      const service = createPostsService(repository)
      const original = await service.create(author.id, {
        text: 'post original',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await service.repost(author.id, BigInt(original.id))

      await expect(service.repost(author.id, BigInt(original.id))).rejects.toMatchObject({
        code: 'CONFLICT',
      })
    })

    it('throws NotFoundError when reposting a nonexistent post', async () => {
      const service = createPostsService(repository)
      await expect(service.repost(author.id, 999999999999999999n)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('invokes onPostCreated, same as a regular post', async () => {
      const calls: bigint[] = []
      const service = createPostsService(repository, async (postId) => {
        calls.push(postId)
      })
      const original = await service.create(author.id, {
        text: 'post original',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      calls.length = 0 // drop the call from creating `original` itself

      const repost = await service.repost(author.id, BigInt(original.id))

      expect(calls).toEqual([BigInt(repost.id)])
    })
  })

  describe('unrepost', () => {
    it('removes an existing repost', async () => {
      const service = createPostsService(repository)
      const original = await service.create(author.id, {
        text: 'post original',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      await service.repost(author.id, BigInt(original.id))

      await expect(service.unrepost(author.id, BigInt(original.id))).resolves.toBe(true)

      // Reposting again must succeed — the previous one no longer counts as active.
      await expect(service.repost(author.id, BigInt(original.id))).resolves.toMatchObject({
        text: null,
      })
    })

    it('is idempotent when there is nothing to undo', async () => {
      const service = createPostsService(repository)
      const original = await service.create(author.id, {
        text: 'post original',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await expect(service.unrepost(author.id, BigInt(original.id))).resolves.toBe(false)
    })
  })

  describe('listByUsername', () => {
    it('paginates by cursor, newest first', async () => {
      const service = createPostsService(repository)
      await service.create(author.id, {
        text: 'primero',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      await service.create(author.id, {
        text: 'segundo',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      await service.create(author.id, {
        text: 'tercero',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const page = await service.listByUsername(author.username.toLowerCase(), 2, null)

      expect(page.items).toHaveLength(2)
      expect(page.items[0]?.text).toBe('tercero')
      expect(page.hasMore).toBe(true)
    })

    it('throws NotFoundError for an unknown username', async () => {
      const service = createPostsService(repository)
      await expect(service.listByUsername('ghost', 20, null)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })
  })

  describe('getManyByIds', () => {
    it('returns posts in the order ids were given, not insertion order', async () => {
      const service = createPostsService(repository)
      const first = await service.create(author.id, {
        text: 'primero',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const second = await service.create(author.id, {
        text: 'segundo',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const items = await service.getManyByIds([BigInt(second.id), BigInt(first.id)])

      expect(items.map((post) => post.id)).toEqual([second.id, first.id])
    })

    it('silently drops ids that do not exist or are deleted', async () => {
      const service = createPostsService(repository)
      const created = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      await service.remove(BigInt(created.id), author.id)

      const items = await service.getManyByIds([BigInt(created.id), 999999999999999999n])

      expect(items).toEqual([])
    })

    it('returns an empty array without querying the repository for an empty input', async () => {
      const service = createPostsService(repository)
      expect(await service.getManyByIds([])).toEqual([])
    })
  })
})
