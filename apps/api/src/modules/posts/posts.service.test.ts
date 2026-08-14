import type { Post, PostCounters } from '@x/db'
import { generateId } from '@x/utils'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AuthorRow, PostEntityRow, PostRepository } from './posts.repository.js'
import { createPostsService } from './posts.service.js'

// Hand-rolled — models only the hash operations post-counters-cache.ts
// actually issues (HGETALL, HSETNX, HINCRBY), matching the fake-Redis
// convention used across this codebase's other service tests (e.g.
// interactions.service.test.ts, which this is copied from verbatim).
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
    moderatorLabel: null,
    reducedReach: false,
    moderatorHiddenAt: null,
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
  // `${userId}:${postId}` — enough to fake listLikedPostsByUser without
  // modeling the whole likes table.
  const likedPostIds = new Set<string>()

  const repository: PostRepository = {
    async insertPost(post, entities, counters) {
      postsById.set(
        post.id,
        makePost({
          id: post.id,
          authorId: post.authorId,
          kind: post.kind ?? 'original',
          text: post.text ?? null,
          lang: post.lang ?? null,
          inReplyToId: post.inReplyToId ?? null,
          conversationId: post.conversationId ?? null,
          quotedPostId: post.quotedPostId ?? null,
          replyPolicy: post.replyPolicy ?? 0,
        }),
      )
      entitiesByPostId.set(post.id, entities)
      countersByPostId.set(counters.postId, makeCounters(counters.postId))
    },
    // Same per-item shape as insertPost above, looped — media attachment
    // isn't modeled here either (see insertPost's own comment on that),
    // real validation is posts.integration.test.ts's job.
    async insertThread(items) {
      for (const item of items) {
        postsById.set(
          item.post.id,
          makePost({
            id: item.post.id,
            authorId: item.post.authorId,
            kind: item.post.kind ?? 'original',
            text: item.post.text ?? null,
            lang: item.post.lang ?? null,
            inReplyToId: item.post.inReplyToId ?? null,
            conversationId: item.post.conversationId ?? null,
            replyPolicy: item.post.replyPolicy ?? 0,
          }),
        )
        entitiesByPostId.set(item.post.id, item.entities)
        countersByPostId.set(item.counters.postId, makeCounters(item.counters.postId))
      }
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
    // ROADMAP.md 3.3 — no test in this file puts an author in read-only
    // mode, so always-unrestricted is the right default here; a real
    // restriction is exercised against Postgres in posts.integration.test.ts.
    async findReadOnlyUntil() {
      return null
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
    // 'media' always comes back empty, matching findMediaForPosts' own
    // no-op below — real EXISTS-against-media filtering is covered by
    // posts.integration.test.ts against real Postgres, not this fake.
    async listPostsByAuthor(authorId, limit, cursor, filter = 'posts') {
      return [...postsById.values()]
        .filter((post) => post.authorId === authorId && !post.deletedAt)
        .filter((post) => {
          if (filter === 'replies') return post.kind === 'reply'
          if (filter === 'media') return false
          return post.kind !== 'reply'
        })
        .filter((post) => cursor === null || post.id < cursor)
        .sort((a, b) => (b.id > a.id ? 1 : -1))
        .slice(0, limit)
    },
    async listLikedPostsByUser(userId, limit, cursor) {
      return [...postsById.values()]
        .filter((post) => !post.deletedAt && likedPostIds.has(`${userId}:${post.id}`))
        .filter((post) => cursor === null || post.id < cursor)
        .sort((a, b) => (b.id > a.id ? 1 : -1))
        .slice(0, limit)
    },
    async findAncestors(postId) {
      const ancestors: Post[] = []
      let parentId = postsById.get(postId)?.inReplyToId ?? null
      const seen = new Set<bigint>()
      while (parentId !== null && !seen.has(parentId)) {
        seen.add(parentId)
        const parent = postsById.get(parentId)
        if (!parent) break
        ancestors.push(parent)
        parentId = parent.inReplyToId
      }
      return ancestors
    },
    async findDirectReplies(postId, limit, cursor) {
      return [...postsById.values()]
        .filter((post) => post.inReplyToId === postId && !post.deletedAt)
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
    async findRepostedPostIds(authorId, repostOfIds) {
      const reposted = new Set<bigint>()
      for (const post of postsById.values()) {
        if (
          post.authorId === authorId &&
          post.kind === 'repost' &&
          post.repostOfId !== null &&
          repostOfIds.includes(post.repostOfId) &&
          !post.deletedAt
        ) {
          reposted.add(post.repostOfId)
        }
      }
      return reposted
    },
    // The real repository validates and attaches media atomically inside a
    // SQL transaction (posts.repository.ts's insertPost) — that's exercised
    // by posts.integration.test.ts against real Postgres, not here. This
    // fake stays a no-op: findMediaForPosts always empty, matching a post
    // with no attachments, which is all the service-level tests need.
    async findMediaForPosts() {
      return []
    },
  }

  return { repository, authorsById, likedPostIds, postsById }
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

// Backs "reply_policy: following" (createThread and reply-policy tests
// below) — a plain directed pair set is enough to fake FollowLookup's one
// method.
function createFakeFollowLookup() {
  const following = new Set<string>()
  return {
    followLookup: {
      async isFollowing(followerId: bigint, followeeId: bigint) {
        return following.has(`${followerId}:${followeeId}`)
      },
    },
    follow(followerId: bigint, followeeId: bigint) {
      following.add(`${followerId}:${followeeId}`)
    },
  }
}

// Mirrors createFakeFollowLookup just above — a symmetric pair set is
// enough to fake BlockLookup's one method.
function createFakeBlockLookup() {
  const blocked = new Set<string>()
  return {
    blockLookup: {
      async findBlockedAuthorIds(viewerId: bigint, authorIds: bigint[]) {
        return new Set(authorIds.filter((id) => blocked.has(pairKey(viewerId, id))))
      },
    },
    block(userA: bigint, userB: bigint) {
      blocked.add(pairKey(userA, userB))
      blocked.add(pairKey(userB, userA))
    },
  }
}

function pairKey(a: bigint, b: bigint): string {
  return [a, b].sort((x, y) => (x > y ? 1 : x < y ? -1 : 0)).join(':')
}

// Mirrors createFakeBlockLookup — three small `${userId}:${postId}` sets
// stand in for interactions.repository.ts's likes/bookmarks tables and
// posts.repository.ts's own findRepostedPostIds.
function createFakeViewerStateLookup() {
  const liked = new Set<string>()
  const bookmarked = new Set<string>()
  const reposted = new Set<string>()
  return {
    viewerState: {
      async findLikedPostIds(userId: bigint, postIds: bigint[]) {
        return new Set(postIds.filter((id) => liked.has(`${userId}:${id}`)))
      },
      async findBookmarkedPostIds(userId: bigint, postIds: bigint[]) {
        return new Set(postIds.filter((id) => bookmarked.has(`${userId}:${id}`)))
      },
      async findRepostedPostIds(userId: bigint, postIds: bigint[]) {
        return new Set(postIds.filter((id) => reposted.has(`${userId}:${id}`)))
      },
    },
    like(userId: bigint, postId: bigint) {
      liked.add(`${userId}:${postId}`)
    },
    bookmark(userId: bigint, postId: bigint) {
      bookmarked.add(`${userId}:${postId}`)
    },
    repost(userId: bigint, postId: bigint) {
      reposted.add(`${userId}:${postId}`)
    },
  }
}

// Mirrors createFakeBlockLookup — a protected-author set plus an approved-
// follower set is enough to fake ProtectionLookup's one method, standing in
// for social-graph.repository.ts's real users.is_protected + follows join.
function createFakeProtectionLookup() {
  const protectedAuthorIds = new Set<string>()
  const approvedFollowers = new Set<string>() // `${viewerId}:${authorId}`
  return {
    protectionLookup: {
      async findProtectedHiddenAuthorIds(viewerId: bigint | undefined, authorIds: bigint[]) {
        return new Set(
          authorIds.filter((id) => {
            if (!protectedAuthorIds.has(id.toString())) return false
            if (viewerId === id) return false
            if (viewerId !== undefined && approvedFollowers.has(`${viewerId}:${id}`)) return false
            return true
          }),
        )
      },
    },
    makeProtected(authorId: bigint) {
      protectedAuthorIds.add(authorId.toString())
    },
    approve(viewerId: bigint, authorId: bigint) {
      approvedFollowers.add(`${viewerId}:${authorId}`)
    },
  }
}

describe('createPostsService', () => {
  let repository: PostRepository
  let authorsById: Map<bigint, AuthorRow>
  let likedPostIds: Set<string>
  let postsById: Map<bigint, Post>
  let author: AuthorRow
  let published: unknown[]
  let redis: Redis

  beforeEach(() => {
    const fake = createFakeRepository()
    repository = fake.repository
    authorsById = fake.authorsById
    likedPostIds = fake.likedPostIds
    postsById = fake.postsById
    author = addAuthor(authorsById)
    published = []
    redis = createFakeRedis()
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

    // lang isn't part of the public Post DTO (ROADMAP.md 2.3/2.4 are its
    // only readers so far, both querying Postgres directly) — asserting via
    // the fake repository's stored row, same reasoning as replyPolicy/
    // isSensitive below never being checked through toPostDto either.
    it('detects and stores the post language (roadmap 2.4)', async () => {
      const service = createPostsService(repository)

      const post = await service.create(author.id, {
        text: 'El rápido zorro marrón salta sobre el perro perezoso',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(postsById.get(BigInt(post.id))?.lang).toBe('es')
    })

    it('leaves lang null for a media-only post with no text to detect', async () => {
      const service = createPostsService(repository)

      const post = await service.create(author.id, {
        text: '',
        mediaIds: [generateId()],
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(postsById.get(BigInt(post.id))?.lang).toBeNull()
    })

    it('rejects empty text with no media attached either', async () => {
      const service = createPostsService(repository)

      await expect(
        service.create(author.id, { text: '', replyPolicy: 'everyone', isSensitive: false }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('accepts empty text when at least one media id is attached', async () => {
      const service = createPostsService(repository)

      const post = await service.create(author.id, {
        text: '',
        mediaIds: [generateId()],
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(post.text).toBeNull()
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

    it('notifies the parent author of a reply, but not on a self-reply', async () => {
      const service = createPostsService(repository, undefined, async (data) => {
        published.push(data)
      })
      const stranger = addAuthor(authorsById, { id: generateId(), username: 'eve' })
      const root = await service.create(stranger.id, {
        text: 'raíz',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      published.length = 0 // drop the (none, since root has no parent) noise

      await service.create(author.id, {
        text: 'una respuesta',
        inReplyToId: BigInt(root.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      expect(published).toMatchObject([{ userId: stranger.id.toString(), kind: 'reply' }])

      published.length = 0
      await service.create(stranger.id, {
        text: 'me respondo a mí mismo',
        inReplyToId: BigInt(root.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      expect(published).toEqual([])
    })

    it('notifies the quoted author of a quote', async () => {
      const service = createPostsService(repository, undefined, async (data) => {
        published.push(data)
      })
      const stranger = addAuthor(authorsById, { id: generateId(), username: 'eve' })
      const quoted = await service.create(stranger.id, {
        text: 'post citable',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      published.length = 0

      await service.create(author.id, {
        text: 'una cita',
        quotedPostId: BigInt(quoted.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(published).toMatchObject([{ userId: stranger.id.toString(), kind: 'quote' }])
    })

    it("bumps the parent post's replies counter in Redis", async () => {
      const service = createPostsService(repository, undefined, undefined, undefined, redis)
      const root = await service.create(author.id, {
        text: 'raíz',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await service.create(author.id, {
        text: 'una respuesta',
        inReplyToId: BigInt(root.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(await redis.hgetall(`post:${root.id}:counters`)).toMatchObject({ replies: '1' })
    })

    it("bumps the quoted post's quotes counter in Redis", async () => {
      const service = createPostsService(repository, undefined, undefined, undefined, redis)
      const quoted = await service.create(author.id, {
        text: 'post citable',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await service.create(author.id, {
        text: 'una cita',
        quotedPostId: BigInt(quoted.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(await redis.hgetall(`post:${quoted.id}:counters`)).toMatchObject({ quotes: '1' })
    })

    it('embeds the quoted post (ROADMAP.md 2.1 "Citas")', async () => {
      const service = createPostsService(repository)
      const stranger = addAuthor(authorsById, { id: generateId(), username: 'eve' })
      const quoted = await service.create(stranger.id, {
        text: 'post citable',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const quote = await service.create(author.id, {
        text: 'una cita',
        quotedPostId: BigInt(quoted.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(quote.quotedPost).toMatchObject({
        id: quoted.id,
        text: 'post citable',
        author: { username: 'eve' },
      })
    })

    it('sets quotedPost to null for a post that does not quote anything', async () => {
      const service = createPostsService(repository)

      const post = await service.create(author.id, {
        text: 'hola mundo',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(post.quotedPost).toBeNull()
    })

    it('embeds one level deep only — a quote of a quote does not carry its own nested quotedPost', async () => {
      const service = createPostsService(repository)
      const root = await service.create(author.id, {
        text: 'raíz citable',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const middle = await service.create(author.id, {
        text: 'cita de la raíz',
        quotedPostId: BigInt(root.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const outer = await service.create(author.id, {
        text: 'cita de la cita',
        quotedPostId: BigInt(middle.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(outer.quotedPost).toMatchObject({ id: middle.id, text: 'cita de la raíz' })
      // `Post['quotedPost']`'s own type has no `quotedPost` field to read —
      // contracts/post.ts's embed schema doesn't declare one, so this is
      // enforced at compile time for every caller, not just checked here at
      // runtime. The wire contract backs that up independently by stripping
      // a stray second level instead of erroring — see post.test.ts's
      // "strips a second level of nesting".
    })

    it('leaves quotedPost null once the quoted post has since been deleted', async () => {
      const service = createPostsService(repository)
      const quoted = await service.create(author.id, {
        text: 'será borrado',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const quote = await service.create(author.id, {
        text: 'cita a un post que luego se borra',
        quotedPostId: BigInt(quoted.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      expect(quote.quotedPost).not.toBeNull()

      await service.remove(BigInt(quoted.id), author.id)
      const refetched = await service.getById(BigInt(quote.id))

      expect(refetched.quotedPost).toBeNull()
    })

    it('does not touch Redis counters when no redis client was configured', async () => {
      // The optional-dependency default every other test in this file relies
      // on — must not throw just because nobody passed a redis client.
      const service = createPostsService(repository)
      const root = await service.create(author.id, {
        text: 'raíz',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await expect(
        service.create(author.id, {
          text: 'una respuesta',
          inReplyToId: BigInt(root.id),
          replyPolicy: 'everyone',
          isSensitive: false,
        }),
      ).resolves.toBeDefined()
    })

    it('notifies each mentioned user, but not for a self-mention', async () => {
      const service = createPostsService(repository, undefined, async (data) => {
        published.push(data)
      })
      addAuthor(authorsById, { id: generateId(), username: 'bob' })

      await service.create(author.id, {
        text: `hola @bob @${author.username}`,
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(published).toMatchObject([{ kind: 'mention' }])
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

  describe('createThread', () => {
    it('creates every post in the thread, each replying to the one before it', async () => {
      const service = createPostsService(repository)

      const thread = await service.createThread(author.id, {
        posts: [
          { text: 'uno', isSensitive: false },
          { text: 'dos', isSensitive: false },
          { text: 'tres', isSensitive: false },
        ],
        replyPolicy: 'everyone',
      })

      expect(thread.map((post) => post.text)).toEqual(['uno', 'dos', 'tres'])
      expect(thread[0]?.inReplyToId).toBeNull()
      expect(thread[1]?.inReplyToId).toBe(thread[0]?.id)
      expect(thread[2]?.inReplyToId).toBe(thread[1]?.id)
      // The whole thread shares the root's conversationId — SPECS.md §4.3.
      expect(thread[1]?.conversationId).toBe(thread[0]?.id)
      expect(thread[2]?.conversationId).toBe(thread[0]?.id)
    })

    it('rejects an empty thread', async () => {
      const service = createPostsService(repository)

      await expect(
        service.createThread(author.id, { posts: [], replyPolicy: 'everyone' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('detects the language of each thread item independently (roadmap 2.4)', async () => {
      const service = createPostsService(repository)

      const thread = await service.createThread(author.id, {
        posts: [
          { text: 'El rápido zorro marrón salta sobre el perro perezoso', isSensitive: false },
          { text: 'The quick brown fox jumps over the lazy dog', isSensitive: false },
        ],
        replyPolicy: 'everyone',
      })

      expect(postsById.get(BigInt(thread[0]?.id ?? 0n))?.lang).toBe('es')
      expect(postsById.get(BigInt(thread[1]?.id ?? 0n))?.lang).toBe('en')
    })

    it('rejects a thread over the max length even when the schema layer is bypassed', async () => {
      const service = createPostsService(repository)
      const posts = Array.from({ length: 26 }, (_, i) => ({
        text: `post ${i}`,
        isSensitive: false,
      }))

      await expect(
        service.createThread(author.id, { posts, replyPolicy: 'everyone' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects a thread item with neither text nor media', async () => {
      const service = createPostsService(repository)

      await expect(
        service.createThread(author.id, {
          posts: [
            { text: 'uno', isSensitive: false },
            { text: '', isSensitive: false },
          ],
          replyPolicy: 'everyone',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('replies to an existing post when inReplyToId is given, bumping its replies counter once', async () => {
      const service = createPostsService(repository, undefined, undefined, undefined, redis)
      const root = await service.create(author.id, {
        text: 'raíz externa',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const thread = await service.createThread(author.id, {
        posts: [
          { text: 'uno', isSensitive: false },
          { text: 'dos', isSensitive: false },
        ],
        inReplyToId: BigInt(root.id),
        replyPolicy: 'everyone',
      })

      expect(thread[0]?.inReplyToId).toBe(root.id)
      expect(thread[0]?.conversationId).toBe(root.id)
      expect(await redis.hgetall(`post:${root.id}:counters`)).toMatchObject({ replies: '1' })
    })

    it('notifies the external parent author once, not once per thread item', async () => {
      const service = createPostsService(repository, undefined, async (data) => {
        published.push(data)
      })
      const stranger = addAuthor(authorsById, { id: generateId(), username: 'eve' })
      const root = await service.create(stranger.id, {
        text: 'raíz de eve',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      published.length = 0

      await service.createThread(author.id, {
        posts: [
          { text: 'uno', isSensitive: false },
          { text: 'dos', isSensitive: false },
        ],
        inReplyToId: BigInt(root.id),
        replyPolicy: 'everyone',
      })

      expect(published).toMatchObject([{ userId: stranger.id.toString(), kind: 'reply' }])
    })

    it('throws NotFoundError when inReplyToId points at a nonexistent post', async () => {
      const service = createPostsService(repository)

      await expect(
        service.createThread(author.id, {
          posts: [{ text: 'uno', isSensitive: false }],
          inReplyToId: 999999999999999999n,
          replyPolicy: 'everyone',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it("rejects a thread that violates the external parent's reply policy", async () => {
      const { followLookup } = createFakeFollowLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        followLookup,
      )
      const stranger = addAuthor(authorsById, { id: generateId(), username: 'eve' })
      const root = await service.create(stranger.id, {
        text: 'sólo seguidos',
        replyPolicy: 'following',
        isSensitive: false,
      })

      await expect(
        service.createThread(author.id, {
          posts: [{ text: 'uno', isSensitive: false }],
          inReplyToId: BigInt(root.id),
          replyPolicy: 'everyone',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('notifies a mentioned user once per thread, even if mentioned in more than one item', async () => {
      const service = createPostsService(repository, undefined, async (data) => {
        published.push(data)
      })
      const mentioned = addAuthor(authorsById, { id: generateId(), username: 'bob' })

      await service.createThread(author.id, {
        posts: [
          { text: 'hola @bob', isSensitive: false },
          { text: 'otra vez @bob', isSensitive: false },
        ],
        replyPolicy: 'everyone',
      })

      expect(published).toMatchObject([{ userId: mentioned.id.toString(), kind: 'mention' }])
    })

    it('calls onPostCreated for every post in the thread', async () => {
      const calls: Array<{ postId: bigint; authorId: bigint }> = []
      const service = createPostsService(repository, async (postId, authorId) => {
        calls.push({ postId, authorId })
      })

      const thread = await service.createThread(author.id, {
        posts: [
          { text: 'uno', isSensitive: false },
          { text: 'dos', isSensitive: false },
        ],
        replyPolicy: 'everyone',
      })

      expect(calls).toEqual([
        { postId: BigInt(thread[0]?.id ?? 0n), authorId: author.id },
        { postId: BigInt(thread[1]?.id ?? 0n), authorId: author.id },
      ])
    })
  })

  describe('reply policy', () => {
    it('allows a reply under the default "everyone" policy', async () => {
      const service = createPostsService(repository)
      const stranger = addAuthor(authorsById, { id: generateId(), username: 'eve' })
      const root = await service.create(author.id, {
        text: 'raíz',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await expect(
        service.create(stranger.id, {
          text: 'una respuesta',
          inReplyToId: BigInt(root.id),
          replyPolicy: 'everyone',
          isSensitive: false,
        }),
      ).resolves.toBeDefined()
    })

    it('always allows the parent author to reply to their own post, regardless of policy', async () => {
      const service = createPostsService(repository)
      const root = await service.create(author.id, {
        text: 'raíz',
        replyPolicy: 'mentioned',
        isSensitive: false,
      })

      await expect(
        service.create(author.id, {
          text: 'me respondo a mí mismo',
          inReplyToId: BigInt(root.id),
          replyPolicy: 'everyone',
          isSensitive: false,
        }),
      ).resolves.toBeDefined()
    })

    it('rejects a reply under "following" when the parent author does not follow the replier', async () => {
      const { followLookup } = createFakeFollowLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        followLookup,
      )
      const stranger = addAuthor(authorsById, { id: generateId(), username: 'eve' })
      const root = await service.create(author.id, {
        text: 'raíz',
        replyPolicy: 'following',
        isSensitive: false,
      })

      await expect(
        service.create(stranger.id, {
          text: 'una respuesta',
          inReplyToId: BigInt(root.id),
          replyPolicy: 'everyone',
          isSensitive: false,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('allows a reply under "following" when the parent author follows the replier', async () => {
      const { followLookup, follow } = createFakeFollowLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        followLookup,
      )
      const friend = addAuthor(authorsById, { id: generateId(), username: 'bob' })
      follow(author.id, friend.id)
      const root = await service.create(author.id, {
        text: 'raíz',
        replyPolicy: 'following',
        isSensitive: false,
      })

      await expect(
        service.create(friend.id, {
          text: 'una respuesta',
          inReplyToId: BigInt(root.id),
          replyPolicy: 'everyone',
          isSensitive: false,
        }),
      ).resolves.toBeDefined()
    })

    it('rejects a reply under "mentioned" when the replier was not mentioned', async () => {
      const service = createPostsService(repository)
      const stranger = addAuthor(authorsById, { id: generateId(), username: 'eve' })
      const root = await service.create(author.id, {
        text: 'raíz, sin mencionar a nadie',
        replyPolicy: 'mentioned',
        isSensitive: false,
      })

      await expect(
        service.create(stranger.id, {
          text: 'una respuesta',
          inReplyToId: BigInt(root.id),
          replyPolicy: 'everyone',
          isSensitive: false,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('allows a reply under "mentioned" when the replier was mentioned', async () => {
      const service = createPostsService(repository)
      const friend = addAuthor(authorsById, { id: generateId(), username: 'bob' })
      const root = await service.create(author.id, {
        text: 'raíz, mencionando a @bob',
        replyPolicy: 'mentioned',
        isSensitive: false,
      })

      await expect(
        service.create(friend.id, {
          text: 'una respuesta',
          inReplyToId: BigInt(root.id),
          replyPolicy: 'everyone',
          isSensitive: false,
        }),
      ).resolves.toBeDefined()
    })
  })

  describe('getThread', () => {
    it('returns the ancestor chain root-first, the post itself, and its replies', async () => {
      const service = createPostsService(repository)
      const root = await service.create(author.id, {
        text: 'raíz',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const middle = await service.create(author.id, {
        text: 'en medio',
        inReplyToId: BigInt(root.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const leaf = await service.create(author.id, {
        text: 'la hoja',
        inReplyToId: BigInt(middle.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const reply = await service.create(author.id, {
        text: 'una respuesta a la hoja',
        inReplyToId: BigInt(leaf.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const thread = await service.getThread(BigInt(leaf.id))

      expect(thread.ancestors.map((post) => post.id)).toEqual([root.id, middle.id])
      expect(thread.post.id).toBe(leaf.id)
      expect(thread.replies.map((post) => post.id)).toEqual([reply.id])
      expect(thread.hasMoreReplies).toBe(false)
    })

    it('throws NotFoundError for a nonexistent post', async () => {
      const service = createPostsService(repository)
      await expect(service.getThread(999999999999999999n)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })
  })

  describe('listReplies', () => {
    it('paginates direct replies by cursor, newest first', async () => {
      const service = createPostsService(repository)
      const root = await service.create(author.id, {
        text: 'raíz',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      await service.create(author.id, {
        text: 'respuesta 1',
        inReplyToId: BigInt(root.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      await service.create(author.id, {
        text: 'respuesta 2',
        inReplyToId: BigInt(root.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const page = await service.listReplies(BigInt(root.id), 1, null)

      expect(page.items).toHaveLength(1)
      expect(page.items[0]?.text).toBe('respuesta 2')
      expect(page.hasMore).toBe(true)
    })

    it('throws NotFoundError for a nonexistent post', async () => {
      const service = createPostsService(repository)
      await expect(service.listReplies(999999999999999999n, 20, null)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
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

    it('embeds the quoted post when fetching a quote by id', async () => {
      const service = createPostsService(repository)
      const quoted = await service.create(author.id, {
        text: 'post citable',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const quote = await service.create(author.id, {
        text: 'una cita',
        quotedPostId: BigInt(quoted.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const fetched = await service.getById(BigInt(quote.id))
      expect(fetched.quotedPost).toMatchObject({ id: quoted.id, text: 'post citable' })
    })
  })

  // ROADMAP.md 1.4: GET /posts/:id's `viewer` field — deferred originally
  // because the route was public and needed optional auth, which 2.6 later
  // added for the block/protection checks above without anyone wiring this
  // up too. createPostsService's 10th positional arg (viewerState).
  describe('viewer state (getById)', () => {
    it('omits viewer when there is no viewerId (anonymous)', async () => {
      const { viewerState } = createFakeViewerStateLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        viewerState,
      )
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const fetched = await service.getById(BigInt(post.id))
      expect(fetched.viewer).toBeUndefined()
    })

    it('omits viewer when no viewerState dependency is wired up', async () => {
      const service = createPostsService(repository)
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const fetched = await service.getById(BigInt(post.id), generateId())
      expect(fetched.viewer).toBeUndefined()
    })

    it('reports liked/bookmarked/reposted true only for what the viewer actually did', async () => {
      const { viewerState, like, bookmark } = createFakeViewerStateLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        viewerState,
      )
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const viewer = generateId()
      like(viewer, BigInt(post.id))
      bookmark(viewer, BigInt(post.id))

      const fetched = await service.getById(BigInt(post.id), viewer)
      expect(fetched.viewer).toEqual({ liked: true, bookmarked: true, reposted: false })
    })

    it('reports all-false for a viewer who never interacted with the post', async () => {
      const { viewerState } = createFakeViewerStateLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        viewerState,
      )
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const fetched = await service.getById(BigInt(post.id), generateId())
      expect(fetched.viewer).toEqual({ liked: false, bookmarked: false, reposted: false })
    })

    it("getThread's own `post` field also carries viewer state, since it's built via getById", async () => {
      const { viewerState, repost } = createFakeViewerStateLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        viewerState,
      )
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const viewer = generateId()
      repost(viewer, BigInt(post.id))

      const thread = await service.getThread(BigInt(post.id), viewer)
      expect(thread.post.viewer).toEqual({ liked: false, bookmarked: false, reposted: true })
    })
  })

  // ROADMAP.md 2.6 — every read below takes the same createPostsService(...)
  // 7-arg shape as the reply-policy describe above, just with blockLookup
  // (arg 7) instead of followLookup (arg 6) populated.
  describe('block visibility', () => {
    it('getById 404s a post whose author blocked the viewer', async () => {
      const { blockLookup, block } = createFakeBlockLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        blockLookup,
      )
      const stranger = addAuthor(authorsById, { id: generateId(), username: 'eve' })
      block(stranger.id, author.id)
      const post = await service.create(stranger.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await expect(service.getById(BigInt(post.id), author.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('getById still resolves for a viewer with no block relationship', async () => {
      const { blockLookup } = createFakeBlockLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        blockLookup,
      )
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await expect(service.getById(BigInt(post.id), generateId())).resolves.toMatchObject({
        id: post.id,
      })
    })

    it('hides the embedded quotedPost when its own author blocked the viewer, without hiding the quoting post itself', async () => {
      const { blockLookup, block } = createFakeBlockLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        blockLookup,
      )
      const viewer = generateId()
      const stranger = addAuthor(authorsById, { id: generateId(), username: 'eve' })
      block(stranger.id, viewer)
      const quoted = await service.create(stranger.id, {
        text: 'post de alguien que te bloqueó',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      // `author` has no block relationship with anyone here — only the
      // *quoted* post's author (`stranger`) blocked the viewer.
      const quote = await service.create(author.id, {
        text: 'una cita',
        quotedPostId: BigInt(quoted.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const fetched = await service.getById(BigInt(quote.id), viewer)
      expect(fetched.id).toBe(quote.id)
      expect(fetched.quotedPost).toBeNull()
    })

    it('listByUsername returns an empty page for a blocked profile owner', async () => {
      const { blockLookup, block } = createFakeBlockLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        blockLookup,
      )
      const viewer = generateId()
      block(viewer, author.id)
      await service.create(author.id, { text: 'hola', replyPolicy: 'everyone', isSensitive: false })

      const page = await service.listByUsername(
        author.username.toLowerCase(),
        20,
        null,
        'posts',
        viewer,
      )

      expect(page).toEqual({ items: [], hasMore: false })
    })

    it('listByUsername filters an individually blocked author out of the "likes" tab', async () => {
      const { blockLookup, block } = createFakeBlockLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        blockLookup,
      )
      const bob = addAuthor(authorsById, { id: generateId(), username: 'bob' })
      const viewer = generateId()
      block(viewer, bob.id)
      const likedPost = await service.create(bob.id, {
        text: 'post de bob',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      likedPostIds.add(`${author.id}:${likedPost.id}`)

      const page = await service.listByUsername(
        author.username.toLowerCase(),
        20,
        null,
        'likes',
        viewer,
      )

      expect(page.items).toEqual([])
    })

    it('getManyByIds silently drops a post authored by someone blocked-with the viewer', async () => {
      const { blockLookup, block } = createFakeBlockLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        blockLookup,
      )
      const viewer = generateId()
      block(viewer, author.id)
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(await service.getManyByIds([BigInt(post.id)], viewer)).toEqual([])
    })

    it("getThread 404s when the focused post's author blocked the viewer", async () => {
      const { blockLookup, block } = createFakeBlockLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        blockLookup,
      )
      const viewer = generateId()
      block(viewer, author.id)
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await expect(service.getThread(BigInt(post.id), viewer)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('getThread drops a reply from a third party blocked-with the viewer, without hiding the thread', async () => {
      const { blockLookup, block } = createFakeBlockLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        blockLookup,
      )
      const viewer = generateId()
      const blockedThirdParty = addAuthor(authorsById, { id: generateId(), username: 'eve' })
      block(viewer, blockedThirdParty.id)
      const root = await service.create(author.id, {
        text: 'raíz',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      await service.create(blockedThirdParty.id, {
        text: 'respuesta indeseada',
        inReplyToId: BigInt(root.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const thread = await service.getThread(BigInt(root.id), viewer)

      expect(thread.post.id).toBe(root.id)
      expect(thread.replies).toEqual([])
    })

    it('listReplies 404s when the thread root author blocked the viewer', async () => {
      const { blockLookup, block } = createFakeBlockLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        blockLookup,
      )
      const viewer = generateId()
      block(viewer, author.id)
      const root = await service.create(author.id, {
        text: 'raíz',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await expect(service.listReplies(BigInt(root.id), 20, null, viewer)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })
  })

  // Same 8-arg shape as "block visibility" above, protectionLookup (arg 8)
  // populated instead of blockLookup (arg 7).
  describe('protected account visibility (ROADMAP.md 2.6)', () => {
    it("getById 404s a protected author's post for a viewer who isn't an approved follower", async () => {
      const { protectionLookup, makeProtected } = createFakeProtectionLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        protectionLookup,
      )
      makeProtected(author.id)
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await expect(service.getById(BigInt(post.id), generateId())).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('getById 404s the same post for an anonymous (no viewerId) visitor', async () => {
      const { protectionLookup, makeProtected } = createFakeProtectionLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        protectionLookup,
      )
      makeProtected(author.id)
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await expect(service.getById(BigInt(post.id))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('getById still resolves for the protected author themself', async () => {
      const { protectionLookup, makeProtected } = createFakeProtectionLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        protectionLookup,
      )
      makeProtected(author.id)
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await expect(service.getById(BigInt(post.id), author.id)).resolves.toMatchObject({
        id: post.id,
      })
    })

    it('getById resolves for an approved follower', async () => {
      const { protectionLookup, makeProtected, approve } = createFakeProtectionLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        protectionLookup,
      )
      makeProtected(author.id)
      const viewer = generateId()
      approve(viewer, author.id)
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      await expect(service.getById(BigInt(post.id), viewer)).resolves.toMatchObject({ id: post.id })
    })

    it('listByUsername returns an empty page for a protected profile the viewer does not follow', async () => {
      const { protectionLookup, makeProtected } = createFakeProtectionLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        protectionLookup,
      )
      makeProtected(author.id)
      await service.create(author.id, { text: 'hola', replyPolicy: 'everyone', isSensitive: false })

      const page = await service.listByUsername(
        author.username.toLowerCase(),
        20,
        null,
        'posts',
        generateId(),
      )

      expect(page).toEqual({ items: [], hasMore: false })
    })

    it('getManyByIds silently drops a post from a protected author the viewer does not follow', async () => {
      const { protectionLookup, makeProtected } = createFakeProtectionLookup()
      const service = createPostsService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        protectionLookup,
      )
      makeProtected(author.id)
      const viewer = generateId()
      const post = await service.create(author.id, {
        text: 'hola',
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      expect(await service.getManyByIds([BigInt(post.id)], viewer)).toEqual([])
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

    it('notifies the original author, but not on a self-repost', async () => {
      const service = createPostsService(repository, undefined, async (data) => {
        published.push(data)
      })
      const original = await service.create(author.id, {
        text: 'post original',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const reposter = addAuthor(authorsById, { id: generateId(), username: 'bob' })
      published.length = 0

      await service.repost(reposter.id, BigInt(original.id))
      expect(published).toMatchObject([{ userId: author.id.toString(), kind: 'repost' }])

      published.length = 0
      await service.unrepost(reposter.id, BigInt(original.id))
      await service.repost(author.id, BigInt(original.id))
      expect(published).toEqual([])
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

    it('excludes replies from the default "posts" filter', async () => {
      const service = createPostsService(repository)
      const root = await service.create(author.id, {
        text: 'raíz',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      await service.create(author.id, {
        text: 'respuesta',
        inReplyToId: BigInt(root.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const page = await service.listByUsername(author.username.toLowerCase(), 20, null, 'posts')

      expect(page.items.map((item) => item.id)).toEqual([root.id])
    })

    it('returns only replies when filter is "replies"', async () => {
      const service = createPostsService(repository)
      const root = await service.create(author.id, {
        text: 'raíz',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const reply = await service.create(author.id, {
        text: 'respuesta',
        inReplyToId: BigInt(root.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const page = await service.listByUsername(author.username.toLowerCase(), 20, null, 'replies')

      expect(page.items.map((item) => item.id)).toEqual([reply.id])
    })

    it('returns posts liked by the user rather than authored by them when filter is "likes"', async () => {
      const service = createPostsService(repository)
      const other = addAuthor(authorsById, { id: generateId(), username: 'bob' })
      const likedPost = await service.create(other.id, {
        text: 'post de bob',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      await service.create(author.id, {
        text: 'post propio, no debería aparecer',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      likedPostIds.add(`${author.id}:${likedPost.id}`)

      const page = await service.listByUsername(author.username.toLowerCase(), 20, null, 'likes')

      expect(page.items.map((item) => item.id)).toEqual([likedPost.id])
    })

    it('embeds quotedPost for a quote appearing in a profile page', async () => {
      const service = createPostsService(repository)
      const quoted = await service.create(author.id, {
        text: 'post citable',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      await service.create(author.id, {
        text: 'una cita',
        quotedPostId: BigInt(quoted.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const page = await service.listByUsername(author.username.toLowerCase(), 20, null, 'posts')

      const quote = page.items.find((item) => item.text === 'una cita')
      expect(quote?.quotedPost).toMatchObject({ id: quoted.id, text: 'post citable' })
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

    it('embeds quotedPost for a quote hydrated as part of a batch — the timeline/lists/bookmarks path (ROADMAP.md 2.1)', async () => {
      const service = createPostsService(repository)
      const quoted = await service.create(author.id, {
        text: 'post citable',
        replyPolicy: 'everyone',
        isSensitive: false,
      })
      const quote = await service.create(author.id, {
        text: 'una cita',
        quotedPostId: BigInt(quoted.id),
        replyPolicy: 'everyone',
        isSensitive: false,
      })

      const items = await service.getManyByIds([BigInt(quote.id)])

      expect(items[0]?.quotedPost).toMatchObject({ id: quoted.id, text: 'post citable' })
    })
  })
})
