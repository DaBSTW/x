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
}
type FakeFollow = { followerId: bigint; followeeId: bigint; createdAt: Date }

function createFakeRepository() {
  const users = new Map<bigint, FakeUser>()
  const followsList: FakeFollow[] = []

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
    async findUserIdByUsername(usernameLower) {
      for (const user of users.values()) {
        if (user.username.toLowerCase() === usernameLower) return user.id
      }
      return null
    },
    async userExists(id) {
      return users.has(id)
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
      const followerCountOf = (id: bigint) => followsList.filter((f) => f.followeeId === id).length
      return [...users.values()]
        .filter((user) => user.id !== userId && !alreadyFollowed.has(user.id))
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
  })
})
