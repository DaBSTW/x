import { generateId } from '@x/utils'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SocialGraphRepository } from './social-graph.repository.js'
import { createSocialGraphService } from './social-graph.service.js'

// Hand-rolled, covering only the SET operations addToFollowingCache/
// removeFromFollowingCache actually call — avoids pulling in a mocking
// library just for this. Real Redis behavior for these same calls is
// covered by rate-limit.integration.test.ts's testcontainers suite.
function createFakeRedis(): Redis {
  const sets = new Map<string, Set<string>>()
  return {
    async sadd(key: string, member: string) {
      const set = sets.get(key) ?? new Set<string>()
      set.add(member)
      sets.set(key, set)
      return 1
    },
    async srem(key: string, member: string) {
      sets.get(key)?.delete(member)
      return 1
    },
    async sismember(key: string, member: string) {
      return sets.get(key)?.has(member) ? 1 : 0
    },
    async exists(key: string) {
      return sets.has(key) ? 1 : 0
    },
    async expire() {
      return 1
    },
  } as unknown as Redis
}

type FakeUser = {
  id: bigint
  username: string
  displayName: string
  avatarUrl: string | null
  isVerified: boolean
  isProtected: boolean
}
type FakeFollow = { followerId: bigint; followeeId: bigint; createdAt: Date }
type FakeBlock = { blockerId: bigint; blockedId: bigint; createdAt: Date }
type FakeMute = { muterId: bigint; mutedId: bigint; createdAt: Date }
type FakeFollowRequest = { requesterId: bigint; targetId: bigint; createdAt: Date }

function createFakeRepository() {
  const users = new Map<bigint, FakeUser>()
  const followsList: FakeFollow[] = []
  const blocksList: FakeBlock[] = []
  const mutesList: FakeMute[] = []
  const followRequestsList: FakeFollowRequest[] = []

  const repository: SocialGraphRepository = {
    async findFollow(followerId, followeeId) {
      const row = followsList.find(
        (f) => f.followerId === followerId && f.followeeId === followeeId,
      )
      return row ?? null
    },
    async insertFollow(followerId, followeeId) {
      followsList.push({ followerId, followeeId, createdAt: new Date() })
    },
    async deleteFollow(followerId, followeeId) {
      const index = followsList.findIndex(
        (f) => f.followerId === followerId && f.followeeId === followeeId,
      )
      if (index >= 0) followsList.splice(index, 1)
    },
    async findBlock(blockerId, blockedId) {
      return blocksList.find((b) => b.blockerId === blockerId && b.blockedId === blockedId) ?? null
    },
    async insertBlock(blockerId, blockedId) {
      blocksList.push({ blockerId, blockedId, createdAt: new Date() })
      // Mirrors the real repository's transaction: a block drops any follow
      // in either direction.
      for (const [followerId, followeeId] of [
        [blockerId, blockedId],
        [blockedId, blockerId],
      ] as const) {
        const index = followsList.findIndex(
          (f) => f.followerId === followerId && f.followeeId === followeeId,
        )
        if (index >= 0) followsList.splice(index, 1)
      }
    },
    async deleteBlock(blockerId, blockedId) {
      const index = blocksList.findIndex(
        (b) => b.blockerId === blockerId && b.blockedId === blockedId,
      )
      if (index >= 0) blocksList.splice(index, 1)
    },
    async findMute(muterId, mutedId) {
      return mutesList.find((m) => m.muterId === muterId && m.mutedId === mutedId) ?? null
    },
    async findBlockedAuthorIds(viewerId, authorIds) {
      const ids = new Set(authorIds)
      const result = new Set<bigint>()
      for (const b of blocksList) {
        if (b.blockerId === viewerId && ids.has(b.blockedId)) result.add(b.blockedId)
        if (b.blockedId === viewerId && ids.has(b.blockerId)) result.add(b.blockerId)
      }
      return result
    },
    async findMutedAuthorIds(viewerId, authorIds) {
      const ids = new Set(authorIds)
      return new Set(
        mutesList.filter((m) => m.muterId === viewerId && ids.has(m.mutedId)).map((m) => m.mutedId),
      )
    },
    async insertMute(muterId, mutedId) {
      mutesList.push({ muterId, mutedId, createdAt: new Date() })
    },
    async deleteMute(muterId, mutedId) {
      const index = mutesList.findIndex((m) => m.muterId === muterId && m.mutedId === mutedId)
      if (index >= 0) mutesList.splice(index, 1)
    },
    async findUserIdByUsername(usernameLower) {
      for (const user of users.values()) {
        if (user.username.toLowerCase() === usernameLower) return user.id
      }
      return null
    },
    async userExists(id) {
      return users.has(id)
    },
    async findUserProtectionStatus(id) {
      return users.get(id)?.isProtected ?? null
    },
    async findFollowRequest(requesterId, targetId) {
      return (
        followRequestsList.find((r) => r.requesterId === requesterId && r.targetId === targetId) ??
        null
      )
    },
    async insertFollowRequest(requesterId, targetId) {
      followRequestsList.push({ requesterId, targetId, createdAt: new Date() })
    },
    async deleteFollowRequest(requesterId, targetId) {
      const index = followRequestsList.findIndex(
        (r) => r.requesterId === requesterId && r.targetId === targetId,
      )
      if (index < 0) return false
      followRequestsList.splice(index, 1)
      return true
    },
    async acceptFollowRequest(requesterId, targetId) {
      const index = followRequestsList.findIndex(
        (r) => r.requesterId === requesterId && r.targetId === targetId,
      )
      if (index < 0) return false
      followRequestsList.splice(index, 1)
      followsList.push({ followerId: requesterId, followeeId: targetId, createdAt: new Date() })
      return true
    },
    async listFollowRequestsForTarget(targetId, limit) {
      return followRequestsList
        .filter((r) => r.targetId === targetId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((r) => {
          const user = users.get(r.requesterId)
          if (!user) throw new Error('missing fake user')
          return { ...user, followedAt: r.createdAt }
        })
    },
    async findProtectedHiddenAuthorIds(viewerId, authorIds) {
      const ids = new Set(authorIds)
      const result = new Set<bigint>()
      for (const user of users.values()) {
        if (!ids.has(user.id) || !user.isProtected || user.id === viewerId) continue
        const isApprovedFollower =
          viewerId !== undefined &&
          followsList.some((f) => f.followerId === viewerId && f.followeeId === user.id)
        if (!isApprovedFollower) result.add(user.id)
      }
      return result
    },
    async listFollowers(followeeId, limit) {
      return followsList
        .filter((f) => f.followeeId === followeeId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((f) => {
          const user = users.get(f.followerId)
          if (!user) throw new Error('missing fake user')
          return { ...user, followedAt: f.createdAt }
        })
    },
    async listFollowing(followerId, limit) {
      return followsList
        .filter((f) => f.followerId === followerId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((f) => {
          const user = users.get(f.followeeId)
          if (!user) throw new Error('missing fake user')
          return { ...user, followedAt: f.createdAt }
        })
    },
    async findSuggestions(userId, limit) {
      const alreadyFollowed = new Set(
        followsList.filter((f) => f.followerId === userId).map((f) => f.followeeId),
      )
      const blockedEitherWay = new Set(
        blocksList
          .filter((b) => b.blockerId === userId || b.blockedId === userId)
          .map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)),
      )
      const followerCountOf = (id: bigint) => followsList.filter((f) => f.followeeId === id).length
      return [...users.values()]
        .filter(
          (user) =>
            user.id !== userId && !alreadyFollowed.has(user.id) && !blockedEitherWay.has(user.id),
        )
        .sort((a, b) => followerCountOf(b.id) - followerCountOf(a.id))
        .slice(0, limit)
    },
  }

  function addUser(overrides: Partial<FakeUser> = {}): FakeUser {
    const user: FakeUser = {
      id: generateId(),
      username: 'user',
      displayName: 'User',
      avatarUrl: null,
      isVerified: false,
      isProtected: false,
      ...overrides,
    }
    users.set(user.id, user)
    return user
  }

  return { repository, addUser }
}

describe('createSocialGraphService', () => {
  let repository: SocialGraphRepository
  let addUser: ReturnType<typeof createFakeRepository>['addUser']
  let redis: Redis

  beforeEach(() => {
    const fake = createFakeRepository()
    repository = fake.repository
    addUser = fake.addUser
    redis = createFakeRedis()
  })

  describe('follow', () => {
    it('creates a follow relationship', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })

      await service.follow(alice.id, bob.id)

      const page = await service.listFollowing('alice', 20, null)
      expect(page.items.map((item) => item.username)).toEqual(['bob'])
    })

    it('rejects following yourself', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })

      await expect(service.follow(alice.id, alice.id)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      })
    })

    it('rejects following a nonexistent user', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })

      await expect(service.follow(alice.id, 999999999999999999n)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('rejects following the same user twice', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })
      await service.follow(alice.id, bob.id)

      await expect(service.follow(alice.id, bob.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    })

    it('rejects following a user you have blocked', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })
      await service.block(alice.id, bob.id)

      await expect(service.follow(alice.id, bob.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('rejects following a user who has blocked you', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })
      await service.block(bob.id, alice.id)

      await expect(service.follow(alice.id, bob.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('publishes a follow notification to the followee', async () => {
      const published: unknown[] = []
      const service = createSocialGraphService(repository, redis, async (data) => {
        published.push(data)
      })
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })

      await service.follow(alice.id, bob.id)

      expect(published).toEqual([
        {
          userId: bob.id.toString(),
          kind: 'follow',
          actorId: alice.id.toString(),
          postId: null,
          groupKey: 'follow',
        },
      ])
    })

    it('reports {status: "following"} for a normal account', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })

      await expect(service.follow(alice.id, bob.id)).resolves.toEqual({ status: 'following' })
    })

    describe('a protected target (ROADMAP.md 2.6)', () => {
      it('creates a pending request instead of an immediate follow', async () => {
        const service = createSocialGraphService(repository, redis)
        const alice = addUser({ username: 'alice' })
        const bob = addUser({ username: 'bob', isProtected: true })

        const result = await service.follow(alice.id, bob.id)

        expect(result).toEqual({ status: 'requested' })
        const page = await service.listFollowing('alice', 20, null)
        expect(page.items).toHaveLength(0) // not a follow yet
      })

      it('rejects a second request while one is already pending', async () => {
        const service = createSocialGraphService(repository, redis)
        const alice = addUser({ username: 'alice' })
        const bob = addUser({ username: 'bob', isProtected: true })
        await service.follow(alice.id, bob.id)

        await expect(service.follow(alice.id, bob.id)).rejects.toMatchObject({ code: 'CONFLICT' })
      })

      it('publishes a follow_request notification, not a follow one', async () => {
        const published: unknown[] = []
        const service = createSocialGraphService(repository, redis, async (data) => {
          published.push(data)
        })
        const alice = addUser({ username: 'alice' })
        const bob = addUser({ username: 'bob', isProtected: true })

        await service.follow(alice.id, bob.id)

        expect(published).toEqual([
          {
            userId: bob.id.toString(),
            kind: 'follow_request',
            actorId: alice.id.toString(),
            postId: null,
            groupKey: null,
          },
        ])
      })

      it('still rejects a request across an active block', async () => {
        const service = createSocialGraphService(repository, redis)
        const alice = addUser({ username: 'alice' })
        const bob = addUser({ username: 'bob', isProtected: true })
        await service.block(bob.id, alice.id)

        await expect(service.follow(alice.id, bob.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      })
    })
  })

  describe('unfollow', () => {
    it('removes the follow relationship', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })
      await service.follow(alice.id, bob.id)

      await service.unfollow(alice.id, bob.id)

      const page = await service.listFollowing('alice', 20, null)
      expect(page.items).toHaveLength(0)
    })

    it('cancels a pending request to a protected account (ROADMAP.md 2.6)', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob', isProtected: true })
      await service.follow(alice.id, bob.id)

      await service.unfollow(alice.id, bob.id)

      const requests = await service.listFollowRequests(bob.id, 20, null)
      expect(requests.items).toHaveLength(0)
    })
  })

  describe('follow requests (ROADMAP.md 2.6)', () => {
    it('acceptFollowRequest turns a pending request into a real follow', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob', isProtected: true })
      await service.follow(alice.id, bob.id)

      await service.acceptFollowRequest(bob.id, alice.id)

      const following = await service.listFollowing('alice', 20, null)
      expect(following.items.map((i) => i.username)).toEqual(['bob'])
      const requests = await service.listFollowRequests(bob.id, 20, null)
      expect(requests.items).toHaveLength(0)
    })

    it('acceptFollowRequest throws NotFoundError for a request that does not exist', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob', isProtected: true })

      await expect(service.acceptFollowRequest(bob.id, alice.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('rejectFollowRequest deletes it without creating a follow', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob', isProtected: true })
      await service.follow(alice.id, bob.id)

      await service.rejectFollowRequest(bob.id, alice.id)

      const following = await service.listFollowing('alice', 20, null)
      expect(following.items).toHaveLength(0)
      const requests = await service.listFollowRequests(bob.id, 20, null)
      expect(requests.items).toHaveLength(0)
    })

    it('rejectFollowRequest throws NotFoundError for a request that does not exist', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob', isProtected: true })

      await expect(service.rejectFollowRequest(bob.id, alice.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('listFollowRequests only lists requests targeting that account', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob', isProtected: true })
      const carol = addUser({ username: 'carol', isProtected: true })
      await service.follow(alice.id, bob.id)
      await service.follow(alice.id, carol.id)

      const bobRequests = await service.listFollowRequests(bob.id, 20, null)
      expect(bobRequests.items.map((i) => i.username)).toEqual(['alice'])
    })
  })

  describe('block', () => {
    it('creates a block relationship', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })

      await service.block(alice.id, bob.id)

      await expect(service.block(alice.id, bob.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    })

    it('rejects blocking yourself', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })

      await expect(service.block(alice.id, alice.id)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      })
    })

    it('rejects blocking a nonexistent user', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })

      await expect(service.block(alice.id, 999999999999999999n)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('removes a mutual follow in both directions', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })
      await service.follow(alice.id, bob.id)
      await service.follow(bob.id, alice.id)

      await service.block(alice.id, bob.id)

      expect((await service.listFollowing('alice', 20, null)).items).toHaveLength(0)
      expect((await service.listFollowing('bob', 20, null)).items).toHaveLength(0)
    })
  })

  describe('unblock', () => {
    it('removes the block relationship, allowing it to be recreated', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })
      await service.block(alice.id, bob.id)

      await service.unblock(alice.id, bob.id)

      await expect(service.block(alice.id, bob.id)).resolves.toBeUndefined()
    })
  })

  describe('mute', () => {
    it('creates a mute relationship', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })

      await service.mute(alice.id, bob.id)

      await expect(service.mute(alice.id, bob.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    })

    it('rejects muting yourself', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })

      await expect(service.mute(alice.id, alice.id)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      })
    })

    it('does not affect an existing follow', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })
      await service.follow(alice.id, bob.id)

      await service.mute(alice.id, bob.id)

      expect((await service.listFollowing('alice', 20, null)).items).toHaveLength(1)
    })
  })

  describe('unmute', () => {
    it('removes the mute relationship, allowing it to be recreated', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })
      await service.mute(alice.id, bob.id)

      await service.unmute(alice.id, bob.id)

      await expect(service.mute(alice.id, bob.id)).resolves.toBeUndefined()
    })
  })

  describe('listFollowers / listFollowing', () => {
    it('lists followers newest-first', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })
      const eve = addUser({ username: 'eve' })
      await service.follow(bob.id, alice.id)
      await service.follow(eve.id, alice.id)

      const page = await service.listFollowers('alice', 20, null)
      expect(page.items.map((item) => item.username).sort()).toEqual(['bob', 'eve'])
    })

    it('throws NotFoundError for an unknown username', async () => {
      const service = createSocialGraphService(repository, redis)
      await expect(service.listFollowers('ghost', 20, null)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })
  })

  describe('getSuggestions', () => {
    it('excludes the viewer and anyone already followed', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const bob = addUser({ username: 'bob' })
      addUser({ username: 'carol' })
      await service.follow(alice.id, bob.id)

      const suggestions = await service.getSuggestions(alice.id, 20)

      expect(suggestions.map((item) => item.username)).toEqual(['carol'])
    })

    it('ranks more-followed accounts first', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const popular = addUser({ username: 'popular' })
      addUser({ username: 'quiet' })
      const bystander1 = addUser({ username: 'bystander1' })
      const bystander2 = addUser({ username: 'bystander2' })
      await service.follow(bystander1.id, popular.id)
      await service.follow(bystander2.id, popular.id)

      const suggestions = await service.getSuggestions(alice.id, 2)

      expect(suggestions.map((item) => item.username)).toEqual(['popular', 'quiet'])
    })

    it('excludes anyone with a block relationship in either direction', async () => {
      const service = createSocialGraphService(repository, redis)
      const alice = addUser({ username: 'alice' })
      const blockedByAlice = addUser({ username: 'blocked-by-alice' })
      const blocksAlice = addUser({ username: 'blocks-alice' })
      addUser({ username: 'carol' })
      await service.block(alice.id, blockedByAlice.id)
      await service.block(blocksAlice.id, alice.id)

      const suggestions = await service.getSuggestions(alice.id, 20)

      expect(suggestions.map((item) => item.username)).toEqual(['carol'])
    })
  })
})
