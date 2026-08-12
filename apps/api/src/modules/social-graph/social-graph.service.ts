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
  /**
   * SPECS.md §1.2 "cuentas protegidas": following a protected account
   * creates a pending request instead of an immediate follow (ROADMAP.md
   * 2.6) — the caller needs to know which one happened, hence the return
   * value instead of the plain `Promise<void>` every other mutation here has.
   */
  async function follow(
    followerId: bigint,
    followeeId: bigint,
  ): Promise<{ status: 'following' | 'requested' }> {
    if (followerId === followeeId) {
      throw new ValidationError('cannot follow yourself')
    }
    const targetIsProtected = await repository.findUserProtectionStatus(followeeId)
    if (targetIsProtected === null) {
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

    if (targetIsProtected) {
      if (await repository.findFollowRequest(followerId, followeeId)) {
        throw new ConflictError('a follow request is already pending')
      }
      await repository.insertFollowRequest(followerId, followeeId)
      if (publishNotification) {
        try {
          await publishNotification({
            userId: followeeId.toString(),
            kind: 'follow_request',
            actorId: followerId.toString(),
            postId: null,
            // Unlike 'follow' below: each request needs its own accept/reject,
            // so it can never collapse into "Ana y 12 más" the way passive
            // engagement notifications do.
            groupKey: null,
          })
        } catch {
          // Swallowed intentionally — see posts.service.ts's onPostCreated for why.
        }
      }
      return { status: 'requested' }
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
    return { status: 'following' }
  }

  /** Also cancels a pending request, if that's what actually exists instead of a real follow — deleteFollowRequest is a no-op when there isn't one, so this never needs to ask which case it is first. */
  async function unfollow(followerId: bigint, followeeId: bigint): Promise<void> {
    await repository.deleteFollow(followerId, followeeId)
    await repository.deleteFollowRequest(followerId, followeeId)
    await removeFromFollowingCache(redis, followerId, followeeId)
  }

  async function acceptFollowRequest(targetId: bigint, requesterId: bigint): Promise<void> {
    const accepted = await repository.acceptFollowRequest(requesterId, targetId)
    if (!accepted) throw new NotFoundError('follow request', requesterId.toString())
    await addToFollowingCache(redis, requesterId, targetId)
  }

  /** Same DELETE-the-pending-row operation as a requester cancelling their own request (unfollow's second line) — this is just the target doing it instead. */
  async function rejectFollowRequest(targetId: bigint, requesterId: bigint): Promise<void> {
    const rejected = await repository.deleteFollowRequest(requesterId, targetId)
    if (!rejected) throw new NotFoundError('follow request', requesterId.toString())
  }

  async function listFollowRequests(
    targetId: bigint,
    limit: number,
    cursor: Date | null,
  ): Promise<{ items: FollowListItem[]; hasMore: boolean; lastCreatedAt: Date | null }> {
    const rows = await repository.listFollowRequestsForTarget(targetId, limit + 1, cursor)
    return toPage(rows, limit)
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
    acceptFollowRequest,
    rejectFollowRequest,
    listFollowRequests,
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
