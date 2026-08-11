import type { Post } from '@x/contracts'
import {
  ForbiddenError,
  MAX_POST_GRAPHEMES,
  NotFoundError,
  ValidationError,
  countCharacters,
  generateId,
  parseEntities,
} from '@x/utils'
import type { AuthorRow, PostEntityRow, PostRepository } from './posts.repository.js'
import { ENTITY_KIND_CODES, ENTITY_KIND_NAMES } from './posts.types.js'

const MAX_MENTIONS = 10
const MAX_HASHTAGS = 5

export type CreatePostServiceInput = {
  text: string
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

export type PostsService = ReturnType<typeof createPostsService>

export function createPostsService(repository: PostRepository) {
  async function create(authorId: bigint, input: CreatePostServiceInput): Promise<Post> {
    const graphemeCount = countCharacters(input.text)
    if (graphemeCount === 0) {
      throw new ValidationError('post text is required')
    }
    if (graphemeCount > MAX_POST_GRAPHEMES) {
      throw new ValidationError(`post text exceeds ${MAX_POST_GRAPHEMES} characters`, {
        count: graphemeCount,
        max: MAX_POST_GRAPHEMES,
      })
    }

    const parsed = parseEntities(input.text)
    const mentionCount = parsed.filter((entity) => entity.kind === 'mention').length
    const hashtagCount = parsed.filter((entity) => entity.kind === 'hashtag').length
    if (mentionCount > MAX_MENTIONS) {
      throw new ValidationError(`too many mentions (max ${MAX_MENTIONS})`, { count: mentionCount })
    }
    if (hashtagCount > MAX_HASHTAGS) {
      throw new ValidationError(`too many hashtags (max ${MAX_HASHTAGS})`, { count: hashtagCount })
    }

    let kind: 'original' | 'reply' | 'quote' = 'original'
    let conversationId: bigint | null = null

    if (input.inReplyToId) {
      const parent = await repository.findPostById(input.inReplyToId)
      if (!parent) throw new NotFoundError('post', input.inReplyToId.toString())
      conversationId = parent.conversationId ?? parent.id
      kind = 'reply'
    } else if (input.quotedPostId) {
      const quoted = await repository.findPostById(input.quotedPostId)
      if (!quoted) throw new NotFoundError('post', input.quotedPostId.toString())
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

    await repository.insertPost(
      {
        id,
        authorId,
        kind,
        text: input.text,
        inReplyToId: input.inReplyToId ?? null,
        conversationId,
        quotedPostId: input.quotedPostId ?? null,
        replyPolicy: REPLY_POLICY_CODES[input.replyPolicy],
        isSensitive: input.isSensitive,
      },
      entityRows,
      { postId: id },
    )

    const author = await repository.findAuthorById(authorId)
    if (!author) throw new NotFoundError('user', authorId.toString())

    return toPostDto(
      {
        id,
        text: input.text,
        createdAt: new Date(),
        conversationId,
        inReplyToId: input.inReplyToId ?? null,
      },
      author,
      { likesCount: 0, repostsCount: 0, repliesCount: 0, quotesCount: 0, viewsCount: 0n },
      entityRows,
    )
  }

  async function getById(id: bigint): Promise<Post> {
    const post = await repository.findPostById(id)
    if (!post) throw new NotFoundError('post', id.toString())

    const [author, counters, entities] = await Promise.all([
      repository.findAuthorById(post.authorId),
      repository.findPostCounters(id),
      repository.findPostEntities(id),
    ])
    if (!author) throw new NotFoundError('user', post.authorId.toString())

    return toPostDto(post, author, counters ?? emptyCounters(), entities)
  }

  async function remove(postId: bigint, requesterId: bigint): Promise<void> {
    const post = await repository.findPostById(postId)
    if (!post) throw new NotFoundError('post', postId.toString())
    if (post.authorId !== requesterId) {
      throw new ForbiddenError('only the author can delete this post')
    }
    await repository.softDeletePost(postId)
  }

  async function listByUsername(
    usernameLower: string,
    limit: number,
    cursor: bigint | null,
  ): Promise<{ items: Post[]; hasMore: boolean }> {
    const authorId = await repository.findUserIdByUsername(usernameLower)
    if (!authorId) throw new NotFoundError('user', usernameLower)

    const rows = await repository.listPostsByAuthor(authorId, limit + 1, cursor)
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const postIds = page.map((row) => row.id)
    const [authors, countersRows, entityRows] = await Promise.all([
      repository.findAuthorsByIds([...new Set(page.map((row) => row.authorId))]),
      repository.findCountersForPosts(postIds),
      repository.findEntitiesForPosts(postIds),
    ])
    const authorsById = new Map(authors.map((author) => [author.id, author]))
    const countersByPostId = new Map(countersRows.map((row) => [row.postId, row]))
    const entitiesByPostId = groupBy(entityRows, (row) => row.postId)

    const items = page.map((row) => {
      const author = authorsById.get(row.authorId)
      if (!author) throw new NotFoundError('user', row.authorId.toString())
      return toPostDto(
        row,
        author,
        countersByPostId.get(row.id) ?? emptyCounters(),
        entitiesByPostId.get(row.id) ?? [],
      )
    })

    return { items, hasMore }
  }

  return { create, getById, remove, listByUsername }
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
    conversationId: (post.conversationId ?? post.id).toString(),
    inReplyToId: post.inReplyToId?.toString() ?? null,
    counters: {
      likes: counters.likesCount,
      reposts: counters.repostsCount,
      replies: counters.repliesCount,
      quotes: counters.quotesCount,
      views: Number(counters.viewsCount),
    },
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
