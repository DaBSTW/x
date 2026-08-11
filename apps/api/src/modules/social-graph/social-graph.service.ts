import { ConflictError, NotFoundError, type NotificationJobData, ValidationError } from '@x/utils'
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

  return { follow, unfollow, listFollowers, listFollowing, getSuggestions }
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
