import { ConflictError, NotFoundError, ValidationError } from '@x/utils'
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

export function createSocialGraphService(repository: SocialGraphRepository, redis: Redis) {
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

  return { follow, unfollow, listFollowers, listFollowing }
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
