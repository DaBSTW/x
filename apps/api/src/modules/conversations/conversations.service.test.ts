import { generateId } from '@x/utils'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConversationsRepository, MemberRow } from './conversations.repository.js'
import { createConversationsService } from './conversations.service.js'

// Hand-rolled — only the INCR/PEXPIRE/PTTL sequence enforceRateLimit's Lua
// script issues, same convention as auth.service.test.ts's own fake Redis
// for assertLoginNotBackedOff — plus xadd/publish for publishMessageCreated
// (ROADMAP.md 2.5/2.2), recording what got published so tests can assert on
// the exact channel/event/data instead of just "it didn't throw".
function createFakeRedis() {
  const counts = new Map<string, number>()
  const published: Array<{ channel: string; message: string }> = []
  let nextStreamId = 1
  const redis = {
    async eval(_script: string, _numKeys: number, key: string) {
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      return [next, 1000]
    },
    async xadd() {
      const id = `${Date.now()}-${nextStreamId}`
      nextStreamId += 1
      return id
    },
    async publish(channel: string, message: string) {
      published.push({ channel, message })
      return 1
    },
  } as unknown as Redis
  return { redis, published }
}

/** publishMessageCreated's own try/catch should make a broken Redis publish path invisible to sendMessage's caller — this fake exercises exactly that, xadd throwing before publish is ever reached. */
function createFailingRedis(): Redis {
  return {
    async eval(_script: string, _numKeys: number, _key: string) {
      return [1, 1000]
    },
    async xadd() {
      throw new Error('redis is down')
    },
  } as unknown as Redis
}

type FakeConversation = {
  id: bigint
  isGroup: boolean
  name: string | null
  createdBy: bigint
  lastMessageAt: Date | null
  createdAt: Date
}
type FakeMember = {
  conversationId: bigint
  userId: bigint
  lastReadId: bigint | null
  muted: boolean
  joinedAt: Date
}
type FakeMessage = {
  id: bigint
  conversationId: bigint
  senderId: bigint
  text: string
  mediaId: bigint | null
  sharedPostId: bigint | null
  createdAt: Date
  deletedAt: Date | null
}

function createFakeRepository() {
  const conversationsById = new Map<bigint, FakeConversation>()
  const members: FakeMember[] = []
  const messagesList: FakeMessage[] = []
  const users = new Map<bigint, { username: string; dmPrivacy: number }>()
  const follows = new Set<string>() // `${followerId}:${followeeId}`

  const repository: ConversationsRepository = {
    async insertConversation(conversation) {
      conversationsById.set(conversation.id, {
        ...conversation,
        lastMessageAt: null,
        createdAt: new Date(),
      })
    },
    async insertMembers(conversationId, userIds) {
      for (const userId of userIds) {
        members.push({
          conversationId,
          userId,
          lastReadId: null,
          muted: false,
          joinedAt: new Date(),
        })
      }
    },
    async findConversationById(id) {
      return conversationsById.get(id) ?? null
    },
    async findMember(conversationId, userId) {
      return members.find((m) => m.conversationId === conversationId && m.userId === userId) ?? null
    },
    async find1to1Conversation(userAId, userBId) {
      for (const conversation of conversationsById.values()) {
        if (conversation.isGroup) continue
        const memberIds = members
          .filter((m) => m.conversationId === conversation.id)
          .map((m) => m.userId)
        if (memberIds.length === 2 && memberIds.includes(userAId) && memberIds.includes(userBId)) {
          return conversation.id
        }
      }
      return null
    },
    async listConversationsForUser(userId, limit, cursor) {
      return [...conversationsById.values()]
        .filter((c) => members.some((m) => m.conversationId === c.id && m.userId === userId))
        .filter((c) => cursor === null || c.id < cursor)
        .sort((a, b) => (b.id > a.id ? 1 : -1))
        .slice(0, limit)
        .map((c) => ({
          ...c,
          lastReadId:
            members.find((m) => m.conversationId === c.id && m.userId === userId)?.lastReadId ??
            null,
        }))
    },
    async findMembersForConversations(conversationIds) {
      const rows: MemberRow[] = []
      for (const member of members) {
        if (!conversationIds.includes(member.conversationId)) continue
        const user = users.get(member.userId)
        rows.push({
          conversationId: member.conversationId,
          id: member.userId,
          username: user?.username ?? 'user',
          displayName: user?.username ?? 'User',
          avatarUrl: null,
          isVerified: false,
        })
      }
      return rows
    },
    async countUnread(conversationId, afterId, viewerId) {
      return messagesList.filter(
        (m) =>
          m.conversationId === conversationId &&
          m.senderId !== viewerId &&
          (afterId === null || m.id > afterId),
      ).length
    },
    async insertMessage(message) {
      messagesList.push({
        ...message,
        mediaId: null,
        sharedPostId: null,
        createdAt: new Date(),
        deletedAt: null,
      })
      const conversation = conversationsById.get(message.conversationId)
      if (conversation) conversation.lastMessageAt = new Date()
    },
    async listMessages(conversationId, limit, cursor) {
      return messagesList
        .filter((m) => m.conversationId === conversationId)
        .filter((m) => cursor === null || m.id < cursor)
        .sort((a, b) => (b.id > a.id ? 1 : -1))
        .slice(0, limit)
    },
    async findLatestMessageId(conversationId) {
      const matching = messagesList.filter((m) => m.conversationId === conversationId)
      return matching.length > 0 ? (matching.at(-1)?.id ?? null) : null
    },
    async updateLastRead(conversationId, userId, messageId) {
      const member = members.find((m) => m.conversationId === conversationId && m.userId === userId)
      if (member) member.lastReadId = messageId
    },
    async findDmPrivacy(userId) {
      return users.get(userId)?.dmPrivacy ?? 0
    },
    async userExists(id) {
      return users.has(id)
    },
  }

  function addUser(username: string, dmPrivacy = 0): bigint {
    const id = generateId()
    users.set(id, { username, dmPrivacy })
    return id
  }

  function follow(followerId: bigint, followeeId: bigint) {
    follows.add(`${followerId}:${followeeId}`)
  }

  return {
    repository,
    addUser,
    follow,
    isFollowing: (a: bigint, b: bigint) => follows.has(`${a}:${b}`),
  }
}

describe('createConversationsService', () => {
  let repository: ConversationsRepository
  let addUser: ReturnType<typeof createFakeRepository>['addUser']
  let follow: ReturnType<typeof createFakeRepository>['follow']
  let isFollowing: ReturnType<typeof createFakeRepository>['isFollowing']
  let redis: Redis
  let published: Array<{ channel: string; message: string }>

  beforeEach(() => {
    const fake = createFakeRepository()
    repository = fake.repository
    addUser = fake.addUser
    follow = fake.follow
    isFollowing = fake.isFollowing
    const fakeRedis = createFakeRedis()
    redis = fakeRedis.redis
    published = fakeRedis.published
  })

  function followLookup() {
    return { isFollowing: async (a: bigint, b: bigint) => isFollowing(a, b) }
  }

  describe('create', () => {
    it('creates a 1:1 conversation between two members', async () => {
      const service = createConversationsService(repository, redis)
      const alice = addUser('alice')
      const bob = addUser('bob')

      const conversation = await service.create(alice, { memberIds: [bob], isGroup: false })

      expect(conversation.isGroup).toBe(false)
      expect(conversation.members.map((m) => m.username).sort()).toEqual(['alice', 'bob'])
    })

    it('reuses an existing 1:1 conversation instead of duplicating it', async () => {
      const service = createConversationsService(repository, redis)
      const alice = addUser('alice')
      const bob = addUser('bob')
      const first = await service.create(alice, { memberIds: [bob], isGroup: false })

      const second = await service.create(alice, { memberIds: [bob], isGroup: false })

      expect(second.id).toBe(first.id)
    })

    it('creates a group conversation with multiple members', async () => {
      const service = createConversationsService(repository, redis)
      const alice = addUser('alice')
      const bob = addUser('bob')
      const carol = addUser('carol')

      const conversation = await service.create(alice, {
        memberIds: [bob, carol],
        isGroup: true,
        name: 'Equipo',
      })

      expect(conversation.members).toHaveLength(3)
    })

    it('rejects a 1:1 with more than one other member', async () => {
      const service = createConversationsService(repository, redis)
      const alice = addUser('alice')
      const bob = addUser('bob')
      const carol = addUser('carol')

      await expect(
        service.create(alice, { memberIds: [bob, carol], isGroup: false }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects a nonexistent member', async () => {
      const service = createConversationsService(repository, redis)
      const alice = addUser('alice')

      await expect(
        service.create(alice, { memberIds: [999999999999999999n], isGroup: false }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('rejects messaging a user with dm_privacy "following" you do not follow', async () => {
      const service = createConversationsService(repository, redis, followLookup())
      const alice = addUser('alice')
      const bob = addUser('bob', 1) // 1 = following-only

      await expect(
        service.create(alice, { memberIds: [bob], isGroup: false }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('allows messaging a "following"-only user once they follow you back', async () => {
      const service = createConversationsService(repository, redis, followLookup())
      const alice = addUser('alice')
      const bob = addUser('bob', 1)
      follow(bob, alice)

      await expect(
        service.create(alice, { memberIds: [bob], isGroup: false }),
      ).resolves.toBeDefined()
    })

    it('rejects a 1:1 across an active block, in either direction', async () => {
      const alice = addUser('alice')
      const bob = addUser('bob')
      const service = createConversationsService(repository, redis, undefined, {
        findBlockedAuthorIds: async (_viewer, ids) => new Set(ids.includes(bob) ? [bob] : []),
      })

      await expect(
        service.create(alice, { memberIds: [bob], isGroup: false }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })
  })

  describe('getById', () => {
    it('404s for a non-member', async () => {
      const service = createConversationsService(repository, redis)
      const alice = addUser('alice')
      const bob = addUser('bob')
      const stranger = addUser('stranger')
      const conversation = await service.create(alice, { memberIds: [bob], isGroup: false })

      await expect(service.getById(BigInt(conversation.id), stranger)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })
  })

  describe('listConversations / listMessages / sendMessage / markRead', () => {
    it('sends a message, lists it, and reflects it in the unread count until marked read', async () => {
      const service = createConversationsService(repository, redis)
      const alice = addUser('alice')
      const bob = addUser('bob')
      const conversation = await service.create(alice, { memberIds: [bob], isGroup: false })

      const message = await service.sendMessage(BigInt(conversation.id), alice, 'hola bob')
      expect(message.text).toBe('hola bob')

      const { items } = await service.listMessages(BigInt(conversation.id), bob, 20, null)
      expect(items.map((m) => m.text)).toEqual(['hola bob'])

      const { items: bobConversations } = await service.listConversations(bob, 20, null)
      expect(bobConversations[0]?.unreadCount).toBe(1)

      await service.markRead(BigInt(conversation.id), bob, BigInt(message.id))
      const { items: afterRead } = await service.listConversations(bob, 20, null)
      expect(afterRead[0]?.unreadCount).toBe(0)
    })

    // ROADMAP.md 2.5/2.2: conv:{id} was an authorized, subscribable WS
    // channel since 2.2 shipped, but nothing ever published to it —
    // use-messages.ts/use-conversations.ts's own "no WS gateway yet"
    // comments were stale by the time this was found.
    it('publishes a message.created event on the conversation channel after sending', async () => {
      const service = createConversationsService(repository, redis)
      const alice = addUser('alice')
      const bob = addUser('bob')
      const conversation = await service.create(alice, { memberIds: [bob], isGroup: false })

      const message = await service.sendMessage(BigInt(conversation.id), alice, 'hola bob')

      expect(published).toHaveLength(1)
      expect(published[0]?.channel).toBe(`conv:${conversation.id}`)
      const event = JSON.parse(published[0]?.message ?? '{}')
      expect(event).toMatchObject({
        op: 'event',
        channel: `conv:${conversation.id}`,
        event: 'message.created',
        data: {
          id: message.id,
          conversationId: conversation.id,
          senderId: alice.toString(),
          text: 'hola bob',
        },
      })
      expect(typeof event.eventId).toBe('string')
    })

    it('still sends and returns the message when publishing to Redis fails', async () => {
      const service = createConversationsService(repository, createFailingRedis())
      const alice = addUser('alice')
      const bob = addUser('bob')
      const conversation = await service.create(alice, { memberIds: [bob], isGroup: false })

      const message = await service.sendMessage(BigInt(conversation.id), alice, 'hola bob')
      expect(message.text).toBe('hola bob')

      const { items } = await service.listMessages(BigInt(conversation.id), bob, 20, null)
      expect(items.map((m) => m.text)).toEqual(['hola bob'])
    })

    it('404s sendMessage and listMessages for a non-member', async () => {
      const service = createConversationsService(repository, redis)
      const alice = addUser('alice')
      const bob = addUser('bob')
      const stranger = addUser('stranger')
      const conversation = await service.create(alice, { memberIds: [bob], isGroup: false })

      await expect(
        service.sendMessage(BigInt(conversation.id), stranger, 'hola'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(
        service.listMessages(BigInt(conversation.id), stranger, 20, null),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('enforces the 500/24h message rate limit', async () => {
      const service = createConversationsService(repository, redis)
      const alice = addUser('alice')
      const bob = addUser('bob')
      const conversation = await service.create(alice, { memberIds: [bob], isGroup: false })

      for (let i = 0; i < 500; i += 1) {
        await service.sendMessage(BigInt(conversation.id), alice, `mensaje ${i}`)
      }

      await expect(
        service.sendMessage(BigInt(conversation.id), alice, 'uno de más'),
      ).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' })
    })
  })
})
