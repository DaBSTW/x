import type { Post } from '@x/contracts'
import { generateId } from '@x/utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ListPatch, ListsRepository } from './lists.repository.js'
import { type PostHydrator, createListsService } from './lists.service.js'

type FakeList = {
  id: bigint
  ownerId: bigint
  name: string
  description: string | null
  isPrivate: boolean
  createdAt: Date
}
type FakeUser = {
  id: bigint
  usernameLower: string
  username: string
  displayName: string
  avatarUrl: string | null
  isVerified: boolean
}

function createFakeRepository() {
  const listsById = new Map<bigint, FakeList>()
  const members = new Set<string>() // `${listId}:${userId}`
  const users: FakeUser[] = []
  const memberKey = (listId: bigint, userId: bigint) => `${listId}:${userId}`

  const repository: ListsRepository = {
    async insertList(list) {
      listsById.set(list.id, { ...list, createdAt: new Date() })
    },
    async findListById(id) {
      return listsById.get(id) ?? null
    },
    async updateList(id, patch: ListPatch) {
      const list = listsById.get(id)
      if (list) Object.assign(list, patch)
    },
    async deleteList(id) {
      listsById.delete(id)
      for (const key of members) {
        if (key.startsWith(`${id}:`)) members.delete(key)
      }
    },
    async countMembers(listId) {
      return [...members].filter((key) => key.startsWith(`${listId}:`)).length
    },
    async findMember(listId, userId) {
      return members.has(memberKey(listId, userId))
    },
    async insertMember(listId, userId) {
      members.add(memberKey(listId, userId))
    },
    async deleteMember(listId, userId) {
      members.delete(memberKey(listId, userId))
    },
    async findUserIdByUsername(usernameLower) {
      return users.find((u) => u.usernameLower === usernameLower)?.id ?? null
    },
    async listByOwner(ownerId, limit, cursor) {
      return [...listsById.values()]
        .filter((list) => list.ownerId === ownerId)
        .filter((list) => cursor === null || list.id < cursor)
        .sort((a, b) => (b.id > a.id ? 1 : -1))
        .slice(0, limit)
    },
    async findRecentPostsByMembers(listId, limit) {
      const memberIds = [...members]
        .filter((key) => key.startsWith(`${listId}:`))
        .map((key) => BigInt(key.split(':')[1] as string))
      // The fake doesn't model posts at all — postHydrator fakes below
      // return one synthetic post per member id, which is enough to prove
      // getTimeline wires ids through without needing a real posts table.
      return memberIds.slice(0, limit)
    },
    async findMembers(listId, limit, cursor) {
      const memberIds = new Set(
        [...members]
          .filter((key) => key.startsWith(`${listId}:`))
          .map((key) => BigInt(key.split(':')[1] as string)),
      )
      return users
        .filter((user) => memberIds.has(user.id))
        .filter((user) => cursor === null || user.id < cursor)
        .sort((a, b) => (b.id > a.id ? 1 : -1))
        .slice(0, limit)
        .map((user) => ({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          isVerified: user.isVerified,
        }))
    },
  }

  function addUser(
    usernameLower: string,
    overrides: Partial<Omit<FakeUser, 'id' | 'usernameLower'>> = {},
  ): FakeUser {
    const user: FakeUser = {
      id: generateId(),
      usernameLower,
      username: usernameLower,
      displayName: usernameLower,
      avatarUrl: null,
      isVerified: false,
      ...overrides,
    }
    users.push(user)
    return user
  }

  return { repository, addUser }
}

function makePost(authorId: bigint): Post {
  return {
    id: authorId.toString(),
    text: 'post',
    createdAt: new Date().toISOString(),
    author: {
      id: authorId.toString(),
      username: 'ana',
      displayName: 'Ana',
      avatarUrl: null,
      isVerified: false,
    },
    entities: [],
    media: [],
    conversationId: authorId.toString(),
    inReplyToId: null,
    counters: { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 },
    quotedPost: null,
  }
}

function createFakeHydrator(): PostHydrator {
  return {
    async getManyByIds(ids) {
      return ids.map(makePost)
    },
  }
}

describe('createListsService', () => {
  let repository: ListsRepository
  let addUser: ReturnType<typeof createFakeRepository>['addUser']
  let owner: bigint

  beforeEach(() => {
    const fake = createFakeRepository()
    repository = fake.repository
    addUser = fake.addUser
    owner = generateId()
  })

  describe('create', () => {
    it('creates a public list by default', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Noticias', isPrivate: false })

      expect(list).toMatchObject({
        ownerId: owner.toString(),
        name: 'Noticias',
        description: null,
        isPrivate: false,
        memberCount: 0,
      })
    })
  })

  describe('getById', () => {
    it('returns a public list to anyone, including no viewer at all', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Pública', isPrivate: false })

      await expect(service.getById(BigInt(list.id))).resolves.toMatchObject({ name: 'Pública' })
    })

    it('returns a private list to its owner', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Privada', isPrivate: true })

      await expect(service.getById(BigInt(list.id), owner)).resolves.toMatchObject({
        name: 'Privada',
      })
    })

    it('404s a private list for a stranger', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Privada', isPrivate: true })

      await expect(service.getById(BigInt(list.id), generateId())).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('404s a private list for an anonymous viewer', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Privada', isPrivate: true })

      await expect(service.getById(BigInt(list.id))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('404s a nonexistent list', async () => {
      const service = createListsService(repository, createFakeHydrator())
      await expect(service.getById(999999999999999999n)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })
  })

  describe('update', () => {
    it('lets the owner rename a list', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Antes', isPrivate: false })

      const updated = await service.update(BigInt(list.id), owner, { name: 'Después' })

      expect(updated.name).toBe('Después')
    })

    it('rejects a non-owner', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Antes', isPrivate: false })

      await expect(
        service.update(BigInt(list.id), generateId(), { name: 'Hackeado' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })
  })

  describe('remove', () => {
    it('lets the owner delete a list', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Borrable', isPrivate: false })

      await service.remove(BigInt(list.id), owner)

      await expect(service.getById(BigInt(list.id), owner)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('rejects a non-owner', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Intocable', isPrivate: false })

      await expect(service.remove(BigInt(list.id), generateId())).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })
  })

  describe('addMember / removeMember', () => {
    it('lets the owner add and then remove a member', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Con miembros', isPrivate: false })
      const member = generateId()

      await service.addMember(BigInt(list.id), owner, member)
      expect((await service.getById(BigInt(list.id))).memberCount).toBe(1)

      await service.removeMember(BigInt(list.id), owner, member)
      expect((await service.getById(BigInt(list.id))).memberCount).toBe(0)
    })

    it('rejects adding the same member twice', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Con miembros', isPrivate: false })
      const member = generateId()
      await service.addMember(BigInt(list.id), owner, member)

      await expect(service.addMember(BigInt(list.id), owner, member)).rejects.toMatchObject({
        code: 'CONFLICT',
      })
    })

    it('rejects a non-owner adding a member', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Con miembros', isPrivate: false })

      await expect(
        service.addMember(BigInt(list.id), generateId(), generateId()),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('removing a non-member is a no-op', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Con miembros', isPrivate: false })

      await expect(
        service.removeMember(BigInt(list.id), owner, generateId()),
      ).resolves.toBeUndefined()
    })
  })

  describe('listMembers', () => {
    it('returns each member with their profile fields', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Con miembros', isPrivate: false })
      const bob = addUser('bob', { username: 'bob', displayName: 'Bob', isVerified: true })
      await service.addMember(BigInt(list.id), owner, bob.id)

      const page = await service.listMembers(BigInt(list.id), undefined, 20, null)

      expect(page.items).toEqual([
        {
          id: bob.id.toString(),
          username: 'bob',
          displayName: 'Bob',
          avatarUrl: null,
          isVerified: true,
        },
      ])
      expect(page.hasMore).toBe(false)
    })

    it('returns an empty page for a list with no members yet', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Vacía', isPrivate: false })

      const page = await service.listMembers(BigInt(list.id), undefined, 20, null)

      expect(page).toEqual({ items: [], hasMore: false })
    })

    it('paginates by cursor, newest member first', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Con miembros', isPrivate: false })
      const first = addUser('first')
      const second = addUser('second')
      await service.addMember(BigInt(list.id), owner, first.id)
      await service.addMember(BigInt(list.id), owner, second.id)

      const page = await service.listMembers(BigInt(list.id), undefined, 1, null)

      expect(page.items).toHaveLength(1)
      expect(page.items[0]?.id).toBe(second.id.toString())
      expect(page.hasMore).toBe(true)
    })

    it("404s a private list's members for anyone but its owner", async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Privada', isPrivate: true })

      await expect(
        service.listMembers(BigInt(list.id), generateId(), 20, null),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(service.listMembers(BigInt(list.id), owner, 20, null)).resolves.toMatchObject({
        items: [],
      })
    })
  })

  describe('listByOwner', () => {
    it('404s for an unknown username', async () => {
      const service = createListsService(repository, createFakeHydrator())
      await expect(service.listByOwner('ghost', 20, null)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it("excludes another owner's private lists but keeps their own visible to them", async () => {
      const service = createListsService(repository, createFakeHydrator())
      const user = addUser('ana')
      await service.create(user.id, { name: 'Pública', isPrivate: false })
      await service.create(user.id, { name: 'Privada', isPrivate: true })

      const asStranger = await service.listByOwner('ana', 20, null)
      expect(asStranger.items.map((l) => l.name)).toEqual(['Pública'])

      const asOwner = await service.listByOwner('ana', 20, null, user.id)
      expect(asOwner.items.map((l) => l.name).sort()).toEqual(['Privada', 'Pública'])
    })
  })

  describe('getTimeline', () => {
    it('hydrates member posts through the injected postHydrator', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Con miembros', isPrivate: false })
      const member = generateId()
      await service.addMember(BigInt(list.id), owner, member)

      const { items } = await service.getTimeline(BigInt(list.id), undefined, 20, null)

      expect(items.map((post) => post.author.id)).toEqual([member.toString()])
    })

    it("drops a muted member's posts, unlike bookmarks (ROADMAP.md 2.6/2.8)", async () => {
      const muteLookup = { findMutedAuthorIds: async () => new Set([owner]) }
      const service = createListsService(repository, createFakeHydrator(), muteLookup)
      const list = await service.create(owner, { name: 'Con miembros', isPrivate: false })
      await service.addMember(BigInt(list.id), owner, owner)
      const viewer = generateId()

      const { items } = await service.getTimeline(BigInt(list.id), viewer, 20, null)

      expect(items).toEqual([])
    })

    it('skips mute filtering entirely for an anonymous viewer', async () => {
      const muteLookup = { findMutedAuthorIds: async () => new Set([owner]) }
      const service = createListsService(repository, createFakeHydrator(), muteLookup)
      const list = await service.create(owner, { name: 'Con miembros', isPrivate: false })
      await service.addMember(BigInt(list.id), owner, owner)

      const { items } = await service.getTimeline(BigInt(list.id), undefined, 20, null)

      expect(items).toHaveLength(1)
    })

    it('404s a private list for a non-owner viewer', async () => {
      const service = createListsService(repository, createFakeHydrator())
      const list = await service.create(owner, { name: 'Privada', isPrivate: true })

      await expect(
        service.getTimeline(BigInt(list.id), generateId(), 20, null),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })
  })
})
