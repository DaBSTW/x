import type { Post, PostMediaItem, ProfilePostsFilter } from '@x/contracts'
import {
  ConflictError,
  ForbiddenError,
  MAX_POST_GRAPHEMES,
  NotFoundError,
  type NotificationJobData,
  type ParsedEntity,
  type TrendIngestJobData,
  ValidationError,
  buildPublicUrl,
  countCharacters,
  extractTimestamp,
  generateId,
  parseEntities,
  pickPrimaryVariant,
} from '@x/utils'
import { detectLanguage } from '@x/utils/language'
import type { Redis } from 'ioredis'
import { type CachedCounters, bumpCounter, zeroCounters } from '../../lib/post-counters-cache.js'
import type { AuthorRow, PostEntityRow, PostMediaRow, PostRepository } from './posts.repository.js'
import { ENTITY_KIND_CODES, ENTITY_KIND_NAMES } from './posts.types.js'

/** Backs `reply_policy: 'following'` (ROADMAP.md 2.1) — narrow on purpose, so posts.service.ts doesn't need the rest of social-graph's surface just to ask one question. */
export type FollowLookup = {
  isFollowing(followerId: bigint, followeeId: bigint): Promise<boolean>
}

/** Backs the block-visibility guard on every read below (ROADMAP.md 2.6) — same narrowing reasoning as FollowLookup. `SocialGraphRepository.findBlockedAuthorIds` already matches this shape, so app.ts passes it straight through with no adapter. */
export type BlockLookup = {
  findBlockedAuthorIds(viewerId: bigint, authorIds: bigint[]): Promise<Set<bigint>>
}

/** Backs the protected-account visibility guard (ROADMAP.md 2.6 "cuentas protegidas") — same narrowing reasoning as BlockLookup, and `SocialGraphRepository.findProtectedHiddenAuthorIds` already matches this shape too. Unlike BlockLookup, `viewerId` can be `undefined` here on purpose: an anonymous viewer must still have protected authors hidden, whereas "no viewer" trivially has no blocks to check. */
export type ProtectionLookup = {
  findProtectedHiddenAuthorIds(
    viewerId: bigint | undefined,
    authorIds: bigint[],
  ): Promise<Set<bigint>>
}

/**
 * Backs `viewer.liked/reposted/bookmarked` (SPECS.md §5.4) on `GET
 * /posts/:id` — ROADMAP.md 1.4 originally deferred this here specifically
 * because the route was public and "needed optional auth"; 2.6 added
 * `optionalAuth` for the block/protection checks above, closing that gap
 * without anyone coming back to wire this up too. timeline.service.ts
 * defines a structurally identical type for the same three lookups applied
 * to a whole page instead of one post — not reused directly (timeline
 * already depends on posts as its PostHydrator, so the dependency only
 * goes one way), but any object satisfying one satisfies the other.
 */
export type ViewerStateLookup = {
  findLikedPostIds: (userId: bigint, postIds: bigint[]) => Promise<Set<bigint>>
  findBookmarkedPostIds: (userId: bigint, postIds: bigint[]) => Promise<Set<bigint>>
  findRepostedPostIds: (userId: bigint, postIds: bigint[]) => Promise<Set<bigint>>
}

const MAX_MENTIONS = 10
const MAX_HASHTAGS = 5
// GET /posts/:id/thread's first page of replies — ROADMAP.md 2.1. "Load
// more" beyond this goes through the standalone, cursor-paginated
// GET /posts/:id/replies instead.
const THREAD_REPLIES_PAGE_SIZE = 20
// POST /posts/batch (ROADMAP.md 2.1) — no product spec sets this, chosen the
// same way MAX_MENTIONS/MAX_HASHTAGS were: high enough that no real thread
// hits it, low enough that one request can't wedge the transaction open
// indefinitely. Duplicated as a literal in createThreadSchema (contracts has
// no dependency on this package, same reasoning as MAX_POST_GRAPHEMES's 280).
const MAX_THREAD_POSTS = 25

/**
 * Shared by create() and createThread(): the same per-post text validation
 * and entity parsing either one needs, so a thread item is held to exactly
 * the rules a standalone post is. Throws ValidationError; never checks
 * "text or media" on its own since that also depends on mediaIds, which the
 * caller already has in hand.
 */
function validateAndParseText(text: string): { graphemeCount: number; entities: ParsedEntity[] } {
  const graphemeCount = countCharacters(text)
  if (graphemeCount > MAX_POST_GRAPHEMES) {
    throw new ValidationError(`post text exceeds ${MAX_POST_GRAPHEMES} characters`, {
      count: graphemeCount,
      max: MAX_POST_GRAPHEMES,
    })
  }

  const entities = parseEntities(text)
  const mentionCount = entities.filter((entity) => entity.kind === 'mention').length
  const hashtagCount = entities.filter((entity) => entity.kind === 'hashtag').length
  if (mentionCount > MAX_MENTIONS) {
    throw new ValidationError(`too many mentions (max ${MAX_MENTIONS})`, { count: mentionCount })
  }
  if (hashtagCount > MAX_HASHTAGS) {
    throw new ValidationError(`too many hashtags (max ${MAX_HASHTAGS})`, { count: hashtagCount })
  }
  return { graphemeCount, entities }
}

export type CreatePostServiceInput = {
  text: string
  mediaIds?: bigint[] | undefined
  inReplyToId?: bigint | undefined
  quotedPostId?: bigint | undefined
  replyPolicy: 'everyone' | 'following' | 'mentioned'
  isSensitive: boolean
}

const REPLY_POLICY_CODES: Record<CreatePostServiceInput['replyPolicy'], number> = {
  everyone: 0,
  following: 1,
  mentioned: 2,
}

/**
 * POST /posts/batch (ROADMAP.md 2.1). Deliberately narrower than
 * CreatePostServiceInput: no per-item inReplyToId (each item always replies
 * to the one before it — that's what makes it a thread) and no per-item
 * quotedPostId (quoting mid-thread isn't supported here; a single POST
 * /posts still covers that). `replyPolicy` applies to every post in the
 * thread, not per item — matches the product's own mental model of "a
 * thread", not N independently-configured posts.
 */
export type CreateThreadServiceInput = {
  posts: Array<{
    text: string
    mediaIds?: bigint[] | undefined
    isSensitive: boolean
  }>
  inReplyToId?: bigint | undefined
  replyPolicy: 'everyone' | 'following' | 'mentioned'
}

export type PostsService = ReturnType<typeof createPostsService>

/** Called after a post is durably persisted, to trigger timeline fan-out — SPECS.md §6.1. */
export type OnPostCreated = (postId: bigint, authorId: bigint) => Promise<void>

/** Called for each notification-worthy event a post produces (reply, quote, mention) — ROADMAP.md 1.7. */
export type PublishNotification = (data: NotificationJobData) => Promise<void>

/** Called once per created post that has at least one hashtag — ROADMAP.md 2.4. */
export type PublishTrendIngest = (data: TrendIngestJobData) => Promise<void>

export type MediaUrlConfig = {
  bucket: string
  publicUrlBase: string
}

// Matches .env.example's S3_BUCKET/S3_ENDPOINT defaults — a real deployment
// always passes its own config explicitly (see app.ts); this default only
// exists so the ~30 existing tests that never touch media don't all need
// updating for a config they'll never actually read from.
const DEFAULT_MEDIA_URL_CONFIG: MediaUrlConfig = {
  bucket: 'x-media',
  publicUrlBase: 'http://localhost:9000',
}

export function createPostsService(
  repository: PostRepository,
  onPostCreated?: OnPostCreated,
  publishNotification?: PublishNotification,
  mediaUrlConfig: MediaUrlConfig = DEFAULT_MEDIA_URL_CONFIG,
  // Optional, same reasoning as onPostCreated/publishNotification: production
  // (app.ts) always passes it, and the ~30 existing tests that never assert
  // on reply/quote counters don't need updating for a dependency they'd
  // never exercise either.
  redis?: Redis,
  // Also optional, same posture again: unset means reply_policy's 'following'
  // branch fails open (allows the reply) rather than 500ing a post creation
  // over a dependency the caller chose not to wire up.
  followLookup?: FollowLookup,
  // Also optional, same posture again: unset means every read below skips
  // block filtering entirely rather than failing — every one of the ~40
  // existing calls in this file's own tests never sets up a block, so
  // "no blockLookup" and "no blocks exist" are observationally identical
  // for them.
  blockLookup?: BlockLookup,
  // Also optional, same posture again: unset means protected-account
  // filtering is skipped, not that no accounts are protected.
  protectionLookup?: ProtectionLookup,
  // Also optional, same posture again: unset means no hashtag ever reaches
  // trend scoring (ROADMAP.md 2.4) — a missing dependency, not a broken one.
  publishTrendIngest?: PublishTrendIngest,
  // Also optional, same posture again: unset (or an anonymous viewerId —
  // there's no "self" to look up state for) simply leaves `viewer` absent
  // from the response, same "absent, not false" contract postSchema
  // documents for GET /timeline/home's own use of this.
  viewerState?: ViewerStateLookup,
) {
  /**
   * `undefined` when there's no viewer (anonymous) or nothing wired up —
   * both mean "don't filter" for blocks specifically. Protection filtering
   * runs regardless of whether there's a viewer (an anonymous visitor must
   * still have protected authors hidden) — only "no protectionLookup wired
   * up" skips it. Combines both reasons a post can be unreachable for a
   * given viewer into one Set, so every call site below only has to ask
   * "is this authorId in it," the same single question either reason answers.
   */
  async function findHiddenAuthorIds(
    viewerId: bigint | undefined,
    authorIds: bigint[],
  ): Promise<Set<bigint>> {
    if (authorIds.length === 0) return new Set()
    const [blocked, protectedHidden] = await Promise.all([
      viewerId && blockLookup
        ? blockLookup.findBlockedAuthorIds(viewerId, authorIds)
        : new Set<bigint>(),
      protectionLookup
        ? protectionLookup.findProtectedHiddenAuthorIds(viewerId, authorIds)
        : new Set<bigint>(),
    ])
    return new Set([...blocked, ...protectedHidden])
  }

  /**
   * ROADMAP.md 2.1 "Citas": batch-hydrates the posts a page of quotes points
   * to, keyed by id, so every read path can embed `quotedPost` for free the
   * same way blocks and protected accounts already apply "for free" through
   * findHiddenAuthorIds. Deliberately one level only — this never re-embeds
   * *its own* result's quotedPostId, so a quote-of-a-quote's inner post
   * always renders with `quotedPost: null`, matching every quoting-post UI's
   * convention instead of a schema that's self-referential to unbounded
   * depth. Missing, deleted, or (given `viewerId`) hidden-by-block/
   * protection targets are silently absent from the map — same "a stale
   * reference isn't an error" posture as getManyByIds below.
   */
  async function fetchQuotedPosts(
    quotedPostIds: bigint[],
    viewerId?: bigint,
  ): Promise<Map<bigint, Post>> {
    const ids = [...new Set(quotedPostIds)]
    if (ids.length === 0) return new Map()

    const [rows, countersRows, entityRows, mediaRows] = await Promise.all([
      repository.findPostsByIds(ids),
      repository.findCountersForPosts(ids),
      repository.findEntitiesForPosts(ids),
      repository.findMediaForPosts(ids),
    ])
    const authorIds = [...new Set(rows.map((row) => row.authorId))]
    const [authors, hiddenAuthorIds] = await Promise.all([
      repository.findAuthorsByIds(authorIds),
      findHiddenAuthorIds(viewerId, authorIds),
    ])
    const authorsById = new Map(authors.map((author) => [author.id, author]))
    const countersByPostId = new Map(countersRows.map((row) => [row.postId, row]))
    const entitiesByPostId = groupBy(entityRows, (row) => row.postId)
    const mediaByPostId = groupBy(mediaRows, (row) => row.postId)

    const result = new Map<bigint, Post>()
    for (const row of rows) {
      const author = authorsById.get(row.authorId)
      if (!author || hiddenAuthorIds.has(row.authorId)) continue
      result.set(
        row.id,
        toPostDto(
          row,
          author,
          countersByPostId.get(row.id) ?? emptyCounters(),
          entitiesByPostId.get(row.id) ?? [],
          mediaByPostId.get(row.id) ?? [],
          mediaUrlConfig,
          null,
        ),
      )
    }
    return result
  }

  /**
   * `viewerId` undefined (anonymous, or the dependency simply isn't wired
   * up) leaves the DTO exactly as `toPostDto` built it — `viewer` stays
   * absent, not `false`. Only used by `getById` today (the one route
   * ROADMAP.md 1.4 called out by name); getThread's own `post` field gets
   * this for free since it's built via getById, but ancestors/replies
   * (getManyByIds) and every other list in this file still don't — a
   * narrower fix than a page-wide one, matching the gap as written rather
   * than quietly widening it.
   */
  async function withViewerState(post: Post, viewerId?: bigint): Promise<Post> {
    if (!viewerState || viewerId === undefined) return post
    const id = BigInt(post.id)
    const [liked, bookmarked, reposted] = await Promise.all([
      viewerState.findLikedPostIds(viewerId, [id]),
      viewerState.findBookmarkedPostIds(viewerId, [id]),
      viewerState.findRepostedPostIds(viewerId, [id]),
    ])
    return {
      ...post,
      viewer: { liked: liked.has(id), bookmarked: bookmarked.has(id), reposted: reposted.has(id) },
    }
  }

  async function fetchBaseline(postId: bigint): Promise<CachedCounters> {
    const counters = await repository.findPostCounters(postId)
    if (!counters) return zeroCounters()
    return {
      likes: counters.likesCount,
      reposts: counters.repostsCount,
      replies: counters.repliesCount,
      quotes: counters.quotesCount,
      bookmarks: counters.bookmarkCount,
    }
  }

  /** A reply/quote bumps the *parent's* (or quoted post's) counter — mirrors interactions.service.ts's like/repost bump, just triggered from post creation instead of a dedicated interaction route. */
  async function bumpParentCounter(field: 'replies' | 'quotes', postId: bigint): Promise<void> {
    if (!redis) return
    await bumpCounter(redis, postId, field, 1, () => fetchBaseline(postId))
  }

  /** `reply_policy` enforcement (ROADMAP.md 2.1) — replying to your own post is always allowed regardless of the policy. */
  async function isReplyAllowed(
    parent: { id: bigint; authorId: bigint; replyPolicy: number },
    authorId: bigint,
  ): Promise<boolean> {
    if (parent.authorId === authorId) return true
    if (parent.replyPolicy === REPLY_POLICY_CODES.following) {
      if (!followLookup) return true
      return followLookup.isFollowing(parent.authorId, authorId)
    }
    if (parent.replyPolicy === REPLY_POLICY_CODES.mentioned) {
      const entities = await repository.findPostEntities(parent.id)
      return entities.some(
        (entity) => entity.kind === ENTITY_KIND_CODES.mention && entity.refId === authorId,
      )
    }
    return true
  }

  // Same failure posture as onPostCreated: a queue outage must never fail
  // the write that triggered the notification.
  async function safePublish(data: NotificationJobData): Promise<void> {
    if (!publishNotification) return
    try {
      await publishNotification(data)
    } catch {
      // Swallowed intentionally.
    }
  }

  // Same failure posture as safePublish above — trend scoring (ROADMAP.md
  // 2.4) is a background enrichment, never something a post's own write
  // path can fail over. Only called when hashtags is non-empty (both call
  // sites below already guard on that), same as onPostCreated only firing
  // for a post that actually persisted.
  async function safePublishTrendIngest(
    postId: bigint,
    authorId: bigint,
    hashtags: string[],
    lang: string | null,
  ): Promise<void> {
    if (!publishTrendIngest) return
    try {
      await publishTrendIngest({
        postId: postId.toString(),
        authorId: authorId.toString(),
        hashtags,
        createdAtMs: extractTimestamp(postId),
        lang,
      })
    } catch {
      // Swallowed intentionally.
    }
  }

  async function create(authorId: bigint, input: CreatePostServiceInput): Promise<Post> {
    const mediaIds = input.mediaIds ?? []
    const { graphemeCount, entities: parsed } = validateAndParseText(input.text)
    if (graphemeCount === 0 && mediaIds.length === 0) {
      throw new ValidationError('post text or at least one media attachment is required')
    }

    let kind: 'original' | 'reply' | 'quote' = 'original'
    let conversationId: bigint | null = null
    let parentAuthorId: bigint | null = null
    let quotedAuthorId: bigint | null = null

    if (input.inReplyToId) {
      const parent = await repository.findPostById(input.inReplyToId)
      if (!parent) throw new NotFoundError('post', input.inReplyToId.toString())
      if (!(await isReplyAllowed(parent, authorId))) {
        throw new ForbiddenError("this post's reply policy does not allow you to reply")
      }
      conversationId = parent.conversationId ?? parent.id
      parentAuthorId = parent.authorId
      kind = 'reply'
    } else if (input.quotedPostId) {
      const quoted = await repository.findPostById(input.quotedPostId)
      if (!quoted) throw new NotFoundError('post', input.quotedPostId.toString())
      quotedAuthorId = quoted.authorId
      kind = 'quote'
    }

    const id = generateId()
    // A root post's conversation is itself — SPECS.md §4.3.
    conversationId ??= id

    const mentionUsernames = [
      ...new Set(parsed.filter((e) => e.kind === 'mention').map((e) => e.value.toLowerCase())),
    ]
    const mentionIds = await repository.findUserIdsByUsernames(mentionUsernames)

    const entityRows: PostEntityRow[] = parsed.map((entity) => ({
      postId: id,
      kind: ENTITY_KIND_CODES[entity.kind],
      value: entity.value,
      startIndex: entity.start,
      endIndex: entity.end,
      refId:
        entity.kind === 'mention' ? (mentionIds.get(entity.value.toLowerCase()) ?? null) : null,
    }))

    // lang: best-effort (ROADMAP.md 2.4/2.3) — null for empty/undetectable
    // text is correct, not a fallback failure; a media-only post has no
    // text to detect a language from in the first place. Computed once and
    // reused below for trend ingestion, rather than detected twice.
    const lang = input.text ? detectLanguage(input.text) : null

    // text can legitimately be '' for a media-only post — the DB column
    // stores NULL for "no text", matching how a repost's text is stored.
    await repository.insertPost(
      {
        id,
        authorId,
        kind,
        text: input.text || null,
        lang,
        inReplyToId: input.inReplyToId ?? null,
        conversationId,
        quotedPostId: input.quotedPostId ?? null,
        replyPolicy: REPLY_POLICY_CODES[input.replyPolicy],
        isSensitive: input.isSensitive,
      },
      entityRows,
      { postId: id },
      mediaIds,
    )

    const [author, mediaRows, quotedPostsById] = await Promise.all([
      repository.findAuthorById(authorId),
      repository.findMediaForPosts([id]),
      input.quotedPostId
        ? fetchQuotedPosts([input.quotedPostId], authorId)
        : Promise.resolve(new Map<bigint, Post>()),
    ])
    if (!author) throw new NotFoundError('user', authorId.toString())

    if (input.inReplyToId) {
      await bumpParentCounter('replies', input.inReplyToId)
    }
    if (input.quotedPostId) {
      await bumpParentCounter('quotes', input.quotedPostId)
    }

    // Fan-out is an optimization, not a correctness requirement: lazy
    // timeline reconstruction from Postgres is always a valid fallback
    // (SPECS.md §6.1), so a queue failure here must not fail the request.
    if (onPostCreated) {
      try {
        await onPostCreated(id, authorId)
      } catch {
        // Swallowed intentionally — see comment above.
      }
    }

    // Only hashtags feed trend scoring (SPECS.md §10.4) — nothing to ingest
    // for a post that doesn't have any.
    const hashtags = [...new Set(parsed.filter((e) => e.kind === 'hashtag').map((e) => e.value))]
    if (hashtags.length > 0) {
      await safePublishTrendIngest(id, authorId, hashtags, lang)
    }

    // Nobody gets notified of their own reply/quote/self-mention.
    if (parentAuthorId !== null && parentAuthorId !== authorId) {
      await safePublish({
        userId: parentAuthorId.toString(),
        kind: 'reply',
        actorId: authorId.toString(),
        postId: id.toString(),
        groupKey: null,
      })
    }
    if (quotedAuthorId !== null && quotedAuthorId !== authorId) {
      await safePublish({
        userId: quotedAuthorId.toString(),
        kind: 'quote',
        actorId: authorId.toString(),
        postId: id.toString(),
        groupKey: null,
      })
    }
    for (const mentionedId of new Set(mentionIds.values())) {
      if (mentionedId === authorId) continue
      await safePublish({
        userId: mentionedId.toString(),
        kind: 'mention',
        actorId: authorId.toString(),
        postId: id.toString(),
        groupKey: null,
      })
    }

    return toPostDto(
      {
        id,
        text: input.text || null,
        createdAt: new Date(),
        conversationId,
        inReplyToId: input.inReplyToId ?? null,
      },
      author,
      { likesCount: 0, repostsCount: 0, repliesCount: 0, quotesCount: 0, viewsCount: 0n },
      entityRows,
      mediaRows,
      mediaUrlConfig,
      input.quotedPostId ? (quotedPostsById.get(input.quotedPostId) ?? null) : null,
    )
  }

  /**
   * POST /posts/batch (ROADMAP.md 2.1): a whole thread in one transaction —
   * `posts.repository.ts`'s insertThread rolls every item back together if
   * any one of them is invalid (e.g. a bad media id partway through), so
   * callers never see a half-published thread. Each item after the first
   * replies to the one immediately before it; only the *external* parent
   * (input.inReplyToId, if given) gets its replies counter bumped and its
   * author notified — internal item-to-item links are the caller replying
   * to themself, which bumpParentCounter/safePublish already no-op for one
   * request at a time, but doing that N-1 extra times here for purely
   * cosmetic self-thread bookkeeping isn't worth the Redis round-trips.
   */
  async function createThread(authorId: bigint, input: CreateThreadServiceInput): Promise<Post[]> {
    if (input.posts.length === 0) {
      throw new ValidationError('a thread needs at least one post')
    }
    if (input.posts.length > MAX_THREAD_POSTS) {
      throw new ValidationError(`a thread can have at most ${MAX_THREAD_POSTS} posts`, {
        count: input.posts.length,
        max: MAX_THREAD_POSTS,
      })
    }

    let conversationId: bigint | null = null
    let parentAuthorId: bigint | null = null
    if (input.inReplyToId) {
      const parent = await repository.findPostById(input.inReplyToId)
      if (!parent) throw new NotFoundError('post', input.inReplyToId.toString())
      if (!(await isReplyAllowed(parent, authorId))) {
        throw new ForbiddenError("this post's reply policy does not allow you to reply")
      }
      conversationId = parent.conversationId ?? parent.id
      parentAuthorId = parent.authorId
    }

    const replyPolicyCode = REPLY_POLICY_CODES[input.replyPolicy]
    const mentionedIds = new Set<bigint>()
    const items: Array<{
      post: Parameters<PostRepository['insertThread']>[0][number]['post']
      entities: PostEntityRow[]
      counters: { postId: bigint }
      mediaIds: bigint[]
    }> = []
    // One entry per item that has at least one hashtag — trend-ingested
    // after insertThread succeeds, same "only what actually has hashtags"
    // filter as create() (ROADMAP.md 2.4).
    const trendIngestItems: Array<{ id: bigint; hashtags: string[]; lang: string | null }> = []
    let previousId: bigint | undefined = input.inReplyToId

    for (const postInput of input.posts) {
      const mediaIds = postInput.mediaIds ?? []
      const { graphemeCount, entities: parsed } = validateAndParseText(postInput.text)
      if (graphemeCount === 0 && mediaIds.length === 0) {
        throw new ValidationError('post text or at least one media attachment is required')
      }

      const id = generateId()
      // The thread's own root (no external parent) is its own conversation;
      // every item after it, and every item when there *is* an external
      // parent, shares that same conversationId — SPECS.md §4.3.
      conversationId ??= id

      const mentionUsernames = [
        ...new Set(parsed.filter((e) => e.kind === 'mention').map((e) => e.value.toLowerCase())),
      ]
      const mentionIds = await repository.findUserIdsByUsernames(mentionUsernames)
      for (const mentionedId of mentionIds.values()) mentionedIds.add(mentionedId)

      const entityRows: PostEntityRow[] = parsed.map((entity) => ({
        postId: id,
        kind: ENTITY_KIND_CODES[entity.kind],
        value: entity.value,
        startIndex: entity.start,
        endIndex: entity.end,
        refId:
          entity.kind === 'mention' ? (mentionIds.get(entity.value.toLowerCase()) ?? null) : null,
      }))

      const lang = postInput.text ? detectLanguage(postInput.text) : null
      const hashtags = [...new Set(parsed.filter((e) => e.kind === 'hashtag').map((e) => e.value))]
      if (hashtags.length > 0) {
        trendIngestItems.push({ id, hashtags, lang })
      }

      items.push({
        post: {
          id,
          authorId,
          kind: previousId !== undefined ? 'reply' : 'original',
          text: postInput.text || null,
          lang,
          inReplyToId: previousId ?? null,
          conversationId,
          replyPolicy: replyPolicyCode,
          isSensitive: postInput.isSensitive,
        },
        entities: entityRows,
        counters: { postId: id },
        mediaIds,
      })
      previousId = id
    }

    await repository.insertThread(items, authorId)

    if (input.inReplyToId) {
      await bumpParentCounter('replies', input.inReplyToId)
    }

    const ids = items.map((item) => item.post.id)
    // Fan-out per post — each one is its own timeline entry for followers,
    // same posture as create()'s single call: a queue outage must never
    // fail the write that already committed.
    if (onPostCreated) {
      for (const id of ids) {
        try {
          await onPostCreated(id, authorId)
        } catch {
          // Swallowed intentionally — see comment above.
        }
      }
    }

    for (const trendItem of trendIngestItems) {
      await safePublishTrendIngest(trendItem.id, authorId, trendItem.hashtags, trendItem.lang)
    }

    // input.posts.length is validated non-zero above, so items/ids always
    // has at least one entry — firstId/lastId exist whenever the loop below
    // actually has anything to notify about.
    const firstId = ids.at(0)
    const lastId = ids.at(-1)
    if (parentAuthorId !== null && parentAuthorId !== authorId && firstId !== undefined) {
      await safePublish({
        userId: parentAuthorId.toString(),
        kind: 'reply',
        actorId: authorId.toString(),
        // The thread's first post is the one actually replying to
        // parentAuthorId's, so the notification opens the right place.
        postId: firstId.toString(),
        groupKey: null,
      })
    }
    for (const mentionedId of mentionedIds) {
      if (mentionedId === authorId || lastId === undefined) continue
      await safePublish({
        userId: mentionedId.toString(),
        kind: 'mention',
        actorId: authorId.toString(),
        // Same reasoning as thread notifications elsewhere in this file:
        // one notification per mentioned user for the whole thread, not one
        // per post they happen to be mentioned in.
        postId: lastId.toString(),
        groupKey: null,
      })
    }

    return getManyByIds(ids, authorId)
  }

  /**
   * `viewerId` is optional — this backs a public route (SPECS.md §4.3: "ver
   * posts de" is a service-level rule, not a DB one). A block in either
   * direction, or the author being a protected account the viewer isn't an
   * approved follower of, 404s exactly like a missing post, never a
   * distinct error: leaking *why* a post is unreachable would tell a
   * blocked viewer that a block exists, or a stranger that an account is
   * protected specifically because of them (ROADMAP.md 2.6).
   */
  async function getById(id: bigint, viewerId?: bigint): Promise<Post> {
    const post = await repository.findPostById(id)
    if (!post) throw new NotFoundError('post', id.toString())
    if ((await findHiddenAuthorIds(viewerId, [post.authorId])).size > 0) {
      throw new NotFoundError('post', id.toString())
    }

    const [author, counters, entities, mediaRows, quotedPostsById] = await Promise.all([
      repository.findAuthorById(post.authorId),
      repository.findPostCounters(id),
      repository.findPostEntities(id),
      repository.findMediaForPosts([id]),
      post.quotedPostId
        ? fetchQuotedPosts([post.quotedPostId], viewerId)
        : Promise.resolve(new Map<bigint, Post>()),
    ])
    if (!author) throw new NotFoundError('user', post.authorId.toString())

    const dto = toPostDto(
      post,
      author,
      counters ?? emptyCounters(),
      entities,
      mediaRows,
      mediaUrlConfig,
      post.quotedPostId ? (quotedPostsById.get(post.quotedPostId) ?? null) : null,
    )
    return withViewerState(dto, viewerId)
  }

  async function remove(postId: bigint, requesterId: bigint): Promise<void> {
    const post = await repository.findPostById(postId)
    if (!post) throw new NotFoundError('post', postId.toString())
    if (post.authorId !== requesterId) {
      throw new ForbiddenError('only the author can delete this post')
    }
    await repository.softDeletePost(postId, requesterId)
  }

  /** SPECS.md §4.3: a repost is its own post row, `text IS NULL`, `repost_of_id` set — it fans out like any other post. */
  async function repost(authorId: bigint, originalPostId: bigint): Promise<Post> {
    const original = await repository.findPostById(originalPostId)
    if (!original) throw new NotFoundError('post', originalPostId.toString())
    if (await repository.findActiveRepost(authorId, originalPostId)) {
      throw new ConflictError('already reposted this post')
    }

    const id = generateId()
    const conversationId = original.conversationId ?? original.id
    await repository.insertRepost(
      { id, authorId, repostOfId: originalPostId, conversationId },
      {
        postId: id,
      },
    )

    const author = await repository.findAuthorById(authorId)
    if (!author) throw new NotFoundError('user', authorId.toString())

    if (onPostCreated) {
      try {
        await onPostCreated(id, authorId)
      } catch {
        // Swallowed intentionally — see the comment in create().
      }
    }

    if (original.authorId !== authorId) {
      await safePublish({
        userId: original.authorId.toString(),
        kind: 'repost',
        actorId: authorId.toString(),
        postId: id.toString(),
        groupKey: `repost:${originalPostId}`,
      })
    }

    // A repost has no media of its own — SPECS.md §4.3's `text IS NULL` row;
    // the original post's media is reachable through repost_of_id, not duplicated here.
    return toPostDto(
      { id, text: null, createdAt: new Date(), conversationId, inReplyToId: null },
      author,
      emptyCounters(),
      [],
      [],
      mediaUrlConfig,
    )
  }

  /**
   * Idempotent — undoing a repost that doesn't exist is a no-op, matching
   * unfollow's precedent. Returns whether a repost actually existed, so
   * callers know whether to also decrement a counter.
   */
  async function unrepost(authorId: bigint, originalPostId: bigint): Promise<boolean> {
    const repostId = await repository.findActiveRepost(authorId, originalPostId)
    if (!repostId) return false
    await repository.softDeletePost(repostId, authorId)
    return true
  }

  async function listByUsername(
    usernameLower: string,
    limit: number,
    cursor: bigint | null,
    filter: ProfilePostsFilter = 'posts',
    viewerId?: bigint,
  ): Promise<{ items: Post[]; hasMore: boolean }> {
    const authorId = await repository.findUserIdByUsername(usernameLower)
    if (!authorId) throw new NotFoundError('user', usernameLower)

    // A block with the profile owner, or the profile being a protected
    // account the viewer isn't an approved follower of, hides every tab,
    // not just their own posts — the "likes" tab still surfaces *other*
    // authors below, each checked on their own (ROADMAP.md 2.6). Empty
    // page, not NotFoundError: the profile itself (bio, header) still
    // renders, it just has no posts.
    if ((await findHiddenAuthorIds(viewerId, [authorId])).size > 0) {
      return { items: [], hasMore: false }
    }

    const rows =
      filter === 'likes'
        ? await repository.listLikedPostsByUser(authorId, limit + 1, cursor)
        : await repository.listPostsByAuthor(authorId, limit + 1, cursor, filter)
    const hasMore = rows.length > limit
    const fullPage = hasMore ? rows.slice(0, limit) : rows

    const hiddenLikedAuthorIds =
      filter === 'likes'
        ? await findHiddenAuthorIds(viewerId, [...new Set(fullPage.map((row) => row.authorId))])
        : new Set<bigint>()
    const page =
      hiddenLikedAuthorIds.size > 0
        ? fullPage.filter((row) => !hiddenLikedAuthorIds.has(row.authorId))
        : fullPage

    const postIds = page.map((row) => row.id)
    const [authors, countersRows, entityRows, mediaRows, quotedPostsById] = await Promise.all([
      repository.findAuthorsByIds([...new Set(page.map((row) => row.authorId))]),
      repository.findCountersForPosts(postIds),
      repository.findEntitiesForPosts(postIds),
      repository.findMediaForPosts(postIds),
      fetchQuotedPosts(collectQuotedIds(page), viewerId),
    ])
    const authorsById = new Map(authors.map((author) => [author.id, author]))
    const countersByPostId = new Map(countersRows.map((row) => [row.postId, row]))
    const entitiesByPostId = groupBy(entityRows, (row) => row.postId)
    const mediaByPostId = groupBy(mediaRows, (row) => row.postId)

    const items = page.map((row) => {
      const author = authorsById.get(row.authorId)
      if (!author) throw new NotFoundError('user', row.authorId.toString())
      return toPostDto(
        row,
        author,
        countersByPostId.get(row.id) ?? emptyCounters(),
        entitiesByPostId.get(row.id) ?? [],
        mediaByPostId.get(row.id) ?? [],
        mediaUrlConfig,
        row.quotedPostId ? (quotedPostsById.get(row.quotedPostId) ?? null) : null,
      )
    })

    return { items, hasMore }
  }

  /**
   * Batch hydration for timeline reads (SPECS.md §6.1): one round trip per
   * table regardless of page size. `ids` order is preserved in the result;
   * ids that are missing, soft-deleted, or (given `viewerId`) authored by
   * someone blocked-with the viewer are silently dropped rather than
   * failing the whole page — same "a stale reference is expected, not an
   * error" posture ROADMAP.md 2.6 extends to blocks.
   */
  async function getManyByIds(ids: bigint[], viewerId?: bigint): Promise<Post[]> {
    if (ids.length === 0) return []

    const [rows, countersRows, entityRows, mediaRows] = await Promise.all([
      repository.findPostsByIds(ids),
      repository.findCountersForPosts(ids),
      repository.findEntitiesForPosts(ids),
      repository.findMediaForPosts(ids),
    ])
    const authorIds = [...new Set(rows.map((row) => row.authorId))]
    const [authors, hiddenAuthorIds, quotedPostsById] = await Promise.all([
      repository.findAuthorsByIds(authorIds),
      findHiddenAuthorIds(viewerId, authorIds),
      fetchQuotedPosts(collectQuotedIds(rows), viewerId),
    ])
    const rowsById = new Map(rows.map((row) => [row.id, row]))
    const authorsById = new Map(authors.map((author) => [author.id, author]))
    const countersByPostId = new Map(countersRows.map((row) => [row.postId, row]))
    const entitiesByPostId = groupBy(entityRows, (row) => row.postId)
    const mediaByPostId = groupBy(mediaRows, (row) => row.postId)

    const items: Post[] = []
    for (const id of ids) {
      const row = rowsById.get(id)
      const author = row && authorsById.get(row.authorId)
      if (!row || !author || hiddenAuthorIds.has(row.authorId)) continue
      items.push(
        toPostDto(
          row,
          author,
          countersByPostId.get(id) ?? emptyCounters(),
          entitiesByPostId.get(id) ?? [],
          mediaByPostId.get(id) ?? [],
          mediaUrlConfig,
          row.quotedPostId ? (quotedPostsById.get(row.quotedPostId) ?? null) : null,
        ),
      )
    }
    return items
  }

  /** Direct replies only, cursor-paginated newest-first — the "load more" a thread's initial page (getThread) doesn't already cover. ⚪ ROADMAP.md 2.1 asks for "autor del hilo primero, luego engagement"; this ships the same simple, consistent Snowflake-id ordering as every other list in the app instead — a compound relevance sort needs a compound keyset cursor to paginate correctly, which is real, separable work, not folded in here under time pressure. */
  async function listReplies(
    postId: bigint,
    limit: number,
    cursor: bigint | null,
    viewerId?: bigint,
  ): Promise<{ items: Post[]; hasMore: boolean }> {
    const parent = await repository.findPostById(postId)
    if (!parent) throw new NotFoundError('post', postId.toString())
    // A block with the *thread root's* author, or the root being a
    // protected account's post the viewer can't see, hides the whole reply
    // list — ROADMAP.md 2.6, mirrors getById's "404, not a distinct error"
    // posture. Replies from an unrelated hidden third party are filtered
    // instead, individually, by the getManyByIds call below.
    if ((await findHiddenAuthorIds(viewerId, [parent.authorId])).size > 0) {
      throw new NotFoundError('post', postId.toString())
    }
    const rows = await repository.findDirectReplies(postId, limit + 1, cursor)
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const items = await getManyByIds(
      page.map((row) => row.id),
      viewerId,
    )
    return { items, hasMore }
  }

  /**
   * GET /posts/:id/thread (ROADMAP.md 2.1): the ancestor chain root-first,
   * the post itself, and its first page of direct replies. `viewerId`
   * (ROADMAP.md 2.6): a block with the focused post's author 404s the whole
   * thread via `getById`; a block with an ancestor's or a reply's author
   * just drops that one post, same as a deleted one would.
   */
  async function getThread(
    postId: bigint,
    viewerId?: bigint,
  ): Promise<{
    ancestors: Post[]
    post: Post
    replies: Post[]
    hasMoreReplies: boolean
  }> {
    const post = await getById(postId, viewerId)
    const [ancestorRows, repliesPage] = await Promise.all([
      repository.findAncestors(postId),
      listReplies(postId, THREAD_REPLIES_PAGE_SIZE, null, viewerId),
    ])
    // findAncestors returns closest-parent-first; reverse for root-first display.
    const ancestors = await getManyByIds(ancestorRows.map((row) => row.id).reverse(), viewerId)

    return {
      ancestors,
      post,
      replies: repliesPage.items,
      hasMoreReplies: repliesPage.hasMore,
    }
  }

  return {
    create,
    createThread,
    getById,
    remove,
    repost,
    unrepost,
    listByUsername,
    getManyByIds,
    listReplies,
    getThread,
  }
}

type PostRowLike = {
  id: bigint
  text: string | null
  createdAt: Date
  conversationId: bigint | null
  inReplyToId: bigint | null
}

type CountersRowLike = {
  likesCount: number
  repostsCount: number
  repliesCount: number
  quotesCount: number
  viewsCount: bigint
}

function emptyCounters(): CountersRowLike {
  return { likesCount: 0, repostsCount: 0, repliesCount: 0, quotesCount: 0, viewsCount: 0n }
}

function toPostDto(
  post: PostRowLike,
  author: AuthorRow,
  counters: CountersRowLike,
  entities: Array<{ kind: number; value: string; startIndex: number; endIndex: number }>,
  mediaRows: PostMediaRow[],
  mediaUrlConfig: MediaUrlConfig,
  // ROADMAP.md 2.1 "Citas" — already resolved by the caller (fetchQuotedPosts
  // above), never derived from `post` here: the caller alone knows whether
  // this DTO is itself the one-level-deep embed, in which case it always
  // passes `null` to stop recursion. Defaults to `null` so every existing
  // call site (a post that was never a quote) doesn't need to pass it.
  quotedPost: Post | null = null,
): Post {
  return {
    id: post.id.toString(),
    text: post.text,
    createdAt: post.createdAt.toISOString(),
    author: {
      id: author.id.toString(),
      username: author.username,
      displayName: author.displayName,
      avatarUrl: author.avatarUrl,
      isVerified: author.isVerified,
    },
    entities: entities.map((entity) => ({
      kind: ENTITY_KIND_NAMES[entity.kind] ?? 'mention',
      value: entity.value,
      start: entity.startIndex,
      end: entity.endIndex,
    })),
    media: mediaRows.map((row) => toPostMediaItem(row, mediaUrlConfig)),
    conversationId: (post.conversationId ?? post.id).toString(),
    inReplyToId: post.inReplyToId?.toString() ?? null,
    counters: {
      likes: counters.likesCount,
      reposts: counters.repostsCount,
      replies: counters.repliesCount,
      quotes: counters.quotesCount,
      views: Number(counters.viewsCount),
    },
    quotedPost,
  }
}

/**
 * A post only ever embeds media that's already `ready` (insertPost's WHERE
 * clause guarantees that at attach time), so unlike media.service.ts's
 * toMediaDto this never needs to represent pending/failed — just render it.
 */
function toPostMediaItem(row: PostMediaRow, config: MediaUrlConfig): PostMediaItem {
  const variants = row.variants.map((variant) => ({
    ...variant,
    url: buildPublicUrl(config.publicUrlBase, config.bucket, variant.key),
  }))
  const primary = pickPrimaryVariant(variants)

  return {
    id: row.id.toString(),
    kind: row.kind,
    url: primary?.url ?? buildPublicUrl(config.publicUrlBase, config.bucket, row.storageKey),
    width: row.width,
    height: row.height,
    blurhash: row.blurhash,
    altText: row.altText,
  }
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const group = map.get(k)
    if (group) {
      group.push(item)
    } else {
      map.set(k, [item])
    }
  }
  return map
}

/** The distinct, non-null quotedPostIds a page of rows references — fetchQuotedPosts' input across listByUsername and getManyByIds. */
function collectQuotedIds(rows: Array<{ quotedPostId: bigint | null }>): bigint[] {
  return rows.flatMap((row) => (row.quotedPostId !== null ? [row.quotedPostId] : []))
}
