import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type NotificationJobData,
  ValidationError,
} from '@x/utils'
import type { Redis } from 'ioredis'
import { addToFollowingCache, removeFromFollowingCache } from '../../lib/following-cache.js'
import type { SocialGraphRepository } from './social-graph.repository.js'

export type FollowListItem = {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
  isVerified: boolean
}

export type SocialGraphService = ReturnType<typeof createSocialGraphService>

export type PublishNotification = (data: NotificationJobData) => Promise<void>

export function createSocialGraphService(
  repository: SocialGraphRepository,
  redis: Redis,
  publishNotification?: PublishNotification,
) {
  async function follow(followerId: bigint, followeeId: bigint): Promise<void> {
    if (followerId === followeeId) {
      throw new ValidationError('cannot follow yourself')
    }
    if (!(await repository.userExists(followeeId))) {
      throw new NotFoundError('user', followeeId.toString())
    }
    // SPECS.md §4.3: a block is exclusive with following, in both
    // directions — checked before the already-following lookup so a block
    // added after an old follow (impossible today since insertBlock drops
    // it, but cheap to keep true regardless) always wins.
    if ((await repository.findBlockedAuthorIds(followerId, [followeeId])).size > 0) {
      throw new ForbiddenError('cannot follow a user you have blocked or who has blocked you')
    }
    if (await repository.findFollow(followerId, followeeId)) {
      throw new ConflictError('already following this user')
    }

    await repository.insertFollow(followerId, followeeId)
    await addToFollowingCache(redis, followerId, followeeId)

    if (publishNotification) {
      try {
        await publishNotification({
          userId: followeeId.toString(),
          kind: 'follow',
          actorId: followerId.toString(),
          postId: null,
          // Not per-actor: every "X followed you" for this recipient shares
          // one bucket — `user_id` (implicit in every query) already scopes
          // it to the recipient, so the key only needs to say "this is a
          // follow event", the same way `like:{postId}` says "this is a
          // like on that specific post".
          groupKey: 'follow',
        })
      } catch {
        // Swallowed intentionally — see posts.service.ts's onPostCreated for why.
      }
    }
  }

  async function unfollow(followerId: bigint, followeeId: bigint): Promise<void> {
    await repository.deleteFollow(followerId, followeeId)
    await removeFromFollowingCache(redis, followerId, followeeId)
  }

  async function block(blockerId: bigint, blockedId: bigint): Promise<void> {
    if (blockerId === blockedId) {
      throw new ValidationError('cannot block yourself')
    }
    if (!(await repository.userExists(blockedId))) {
      throw new NotFoundError('user', blockedId.toString())
    }
    if (await repository.findBlock(blockerId, blockedId)) {
      throw new ConflictError('already blocking this user')
    }

    await repository.insertBlock(blockerId, blockedId)
    // insertBlock may have just dropped a follow in either direction —
    // evict both cache entries regardless of which (if either) existed,
    // same no-op-is-safe reasoning as unfollow's own cache eviction.
    await removeFromFollowingCache(redis, blockerId, blockedId)
    await removeFromFollowingCache(redis, blockedId, blockerId)
  }

  async function unblock(blockerId: bigint, blockedId: bigint): Promise<void> {
    await repository.deleteBlock(blockerId, blockedId)
  }

  async function mute(muterId: bigint, mutedId: bigint): Promise<void> {
    if (muterId === mutedId) {
      throw new ValidationError('cannot mute yourself')
    }
    if (!(await repository.userExists(mutedId))) {
      throw new NotFoundError('user', mutedId.toString())
    }
    if (await repository.findMute(muterId, mutedId)) {
      throw new ConflictError('already muting this user')
    }
    await repository.insertMute(muterId, mutedId)
  }

  async function unmute(muterId: bigint, mutedId: bigint): Promise<void> {
    await repository.deleteMute(muterId, mutedId)
  }

  async function listFollowers(
    usernameLower: string,
    limit: number,
    cursor: Date | null,
  ): Promise<{ items: FollowListItem[]; hasMore: boolean; lastCreatedAt: Date | null }> {
    const userId = await repository.findUserIdByUsername(usernameLower)
    if (!userId) throw new NotFoundError('user', usernameLower)

    const rows = await repository.listFollowers(userId, limit + 1, cursor)
    return toPage(rows, limit)
  }

  async function listFollowing(
    usernameLower: string,
    limit: number,
    cursor: Date | null,
  ): Promise<{ items: FollowListItem[]; hasMore: boolean; lastCreatedAt: Date | null }> {
    const userId = await repository.findUserIdByUsername(usernameLower)
    if (!userId) throw new NotFoundError('user', usernameLower)

    const rows = await repository.listFollowing(userId, limit + 1, cursor)
    return toPage(rows, limit)
  }

  async function getSuggestions(userId: bigint, limit: number): Promise<FollowListItem[]> {
    const rows = await repository.findSuggestions(userId, limit)
    return rows.map((row) => ({ ...row, id: row.id.toString() }))
  }

  return {
    follow,
    unfollow,
    block,
    unblock,
    mute,
    unmute,
    listFollowers,
    listFollowing,
    getSuggestions,
  }
}

type FollowRow = {
  id: bigint
  username: string
  displayName: string
  avatarUrl: string | null
  isVerified: boolean
  followedAt: Date
}

function toPage(rows: FollowRow[], limit: number) {
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const lastCreatedAt = page.at(-1)?.followedAt ?? null

  return {
    items: page.map((row) => ({
      id: row.id.toString(),
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      isVerified: row.isVerified,
    })),
    hasMore,
    lastCreatedAt,
  }
}
