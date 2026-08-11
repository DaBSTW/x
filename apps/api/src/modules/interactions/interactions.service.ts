import type { Post } from '@x/contracts'
import { ConflictError, NotFoundError, type NotificationJobData } from '@x/utils'
import type { Redis } from 'ioredis'
import { type CachedCounters, bumpCounter, zeroCounters } from '../../lib/post-counters-cache.js'
import type { PostRepository } from '../posts/posts.repository.js'
import type { PostsService } from '../posts/posts.service.js'
import type { InteractionsRepository } from './interactions.repository.js'

export type InteractionsService = ReturnType<typeof createInteractionsService>

/** Interactions only ever reads a post's existence and counters, never writes posts directly. */
type PostLookup = Pick<PostRepository, 'findPostById' | 'findPostCounters'>
/** Post creation/deletion for reposts stays owned by posts.service.ts (fan-out and its own repost-notification live there). */
type RepostDelegate = Pick<PostsService, 'repost' | 'unrepost'>
/** Called for a like — bookmarks are private and never notify (not in NOTIFICATION_KINDS). */
export type PublishNotification = (data: NotificationJobData) => Promise<void>

export function createInteractionsService(
  repository: InteractionsRepository,
  postsRepository: PostLookup,
  postsService: RepostDelegate,
  redis: Redis,
  publishNotification?: PublishNotification,
) {
  async function safePublish(data: NotificationJobData): Promise<void> {
    if (!publishNotification) return
    try {
      await publishNotification(data)
    } catch {
      // Swallowed intentionally — see posts.service.ts's onPostCreated for why.
    }
  }

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

  async function findPostOrThrow(postId: bigint) {
    const post = await postsRepository.findPostById(postId)
    if (!post) throw new NotFoundError('post', postId.toString())
    return post
  }

  async function like(userId: bigint, postId: bigint): Promise<void> {
    const post = await findPostOrThrow(postId)
    if (await repository.findLike(userId, postId)) {
      throw new ConflictError('already liked this post')
    }
    await repository.insertLike(userId, postId)
    await bumpCounter(redis, postId, 'likes', 1, () => fetchBaseline(postId))

    if (post.authorId !== userId) {
      await safePublish({
        userId: post.authorId.toString(),
        kind: 'like',
        actorId: userId.toString(),
        postId: postId.toString(),
        groupKey: `like:${postId}`,
      })
    }
  }

  async function unlike(userId: bigint, postId: bigint): Promise<void> {
    if (await repository.deleteLike(userId, postId)) {
      await bumpCounter(redis, postId, 'likes', -1, () => fetchBaseline(postId))
    }
  }

  async function bookmark(userId: bigint, postId: bigint): Promise<void> {
    if (!(await postsRepository.findPostById(postId))) {
      throw new NotFoundError('post', postId.toString())
    }
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
