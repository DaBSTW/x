import type { Post } from '@x/contracts'
import { ConflictError, NotFoundError } from '@x/utils'
import type { Redis } from 'ioredis'
import { type CachedCounters, bumpCounter, zeroCounters } from '../../lib/post-counters-cache.js'
import type { PostRepository } from '../posts/posts.repository.js'
import type { PostsService } from '../posts/posts.service.js'
import type { InteractionsRepository } from './interactions.repository.js'

export type InteractionsService = ReturnType<typeof createInteractionsService>

/** Interactions only ever reads a post's existence and counters, never writes posts directly. */
type PostLookup = Pick<PostRepository, 'findPostById' | 'findPostCounters'>
/** Post creation/deletion for reposts stays owned by posts.service.ts (fan-out lives there). */
type RepostDelegate = Pick<PostsService, 'repost' | 'unrepost'>

export function createInteractionsService(
  repository: InteractionsRepository,
  postsRepository: PostLookup,
  postsService: RepostDelegate,
  redis: Redis,
) {
  async function fetchBaseline(postId: bigint): Promise<CachedCounters> {
    const counters = await postsRepository.findPostCounters(postId)
    if (!counters) return zeroCounters()
    return {
      likes: counters.likesCount,
      reposts: counters.repostsCount,
      replies: counters.repliesCount,
      quotes: counters.quotesCount,
      bookmarks: counters.bookmarkCount,
    }
  }

  async function assertPostExists(postId: bigint): Promise<void> {
    if (!(await postsRepository.findPostById(postId))) {
      throw new NotFoundError('post', postId.toString())
    }
  }

  async function like(userId: bigint, postId: bigint): Promise<void> {
    await assertPostExists(postId)
    if (await repository.findLike(userId, postId)) {
      throw new ConflictError('already liked this post')
    }
    await repository.insertLike(userId, postId)
    await bumpCounter(redis, postId, 'likes', 1, () => fetchBaseline(postId))
  }

  async function unlike(userId: bigint, postId: bigint): Promise<void> {
    if (await repository.deleteLike(userId, postId)) {
      await bumpCounter(redis, postId, 'likes', -1, () => fetchBaseline(postId))
    }
  }

  async function bookmark(userId: bigint, postId: bigint): Promise<void> {
    await assertPostExists(postId)
    if (await repository.findBookmark(userId, postId)) {
      throw new ConflictError('already bookmarked this post')
    }
    await repository.insertBookmark(userId, postId)
    await bumpCounter(redis, postId, 'bookmarks', 1, () => fetchBaseline(postId))
  }

  async function unbookmark(userId: bigint, postId: bigint): Promise<void> {
    if (await repository.deleteBookmark(userId, postId)) {
      await bumpCounter(redis, postId, 'bookmarks', -1, () => fetchBaseline(postId))
    }
  }

  async function repost(userId: bigint, postId: bigint): Promise<Post> {
    const created = await postsService.repost(userId, postId)
    await bumpCounter(redis, postId, 'reposts', 1, () => fetchBaseline(postId))
    return created
  }

  async function unrepost(userId: bigint, postId: bigint): Promise<void> {
    if (await postsService.unrepost(userId, postId)) {
      await bumpCounter(redis, postId, 'reposts', -1, () => fetchBaseline(postId))
    }
  }

  return { like, unlike, bookmark, unbookmark, repost, unrepost }
}
