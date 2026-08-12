import type { Post } from '@x/contracts'
import { ConflictError, ForbiddenError, NotFoundError, generateId } from '@x/utils'
import type { PostsService } from '../posts/posts.service.js'
import { type MuteLookup, dropMuted } from '../timeline/timeline.service.js'
import type { ListMemberRow, ListPatch, ListsRepository } from './lists.repository.js'

export type ListDto = {
  id: string
  ownerId: string
  name: string
  description: string | null
  isPrivate: boolean
  memberCount: number
  createdAt: string
}

export type CreateListServiceInput = {
  name: string
  description?: string | undefined
  isPrivate: boolean
}

export type UpdateListServiceInput = {
  name?: string | undefined
  description?: string | undefined
  isPrivate?: boolean | undefined
}

export type ListMemberDto = {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
  isVerified: boolean
}

/** A list's timeline only ever needs to turn ids into posts — same narrowing as timeline.service.ts's own PostHydrator. */
export type PostHydrator = Pick<PostsService, 'getManyByIds'>

type ListRow = {
  id: bigint
  ownerId: bigint
  name: string
  description: string | null
  isPrivate: boolean
  createdAt: Date
}

export type ListsService = ReturnType<typeof createListsService>

export function createListsService(
  repository: ListsRepository,
  postHydrator: PostHydrator,
  muteLookup?: MuteLookup,
) {
  async function toDto(list: ListRow): Promise<ListDto> {
    const memberCount = await repository.countMembers(list.id)
    return {
      id: list.id.toString(),
      ownerId: list.ownerId.toString(),
      name: list.name,
      description: list.description,
      isPrivate: list.isPrivate,
      memberCount,
      createdAt: list.createdAt.toISOString(),
    }
  }

  async function create(ownerId: bigint, input: CreateListServiceInput): Promise<ListDto> {
    const id = generateId()
    await repository.insertList({
      id,
      ownerId,
      name: input.name,
      description: input.description ?? null,
      isPrivate: input.isPrivate,
    })
    const list = await repository.findListById(id)
    if (!list) throw new NotFoundError('list', id.toString())
    return toDto(list)
  }

  /**
   * `viewerId` is optional (this backs a public route) — a private list
   * 404s for anyone but its owner, the same "don't distinguish a hidden
   * resource from a missing one" posture as posts.service.ts's block check
   * (ROADMAP.md 2.6).
   */
  async function getById(id: bigint, viewerId?: bigint): Promise<ListDto> {
    const list = await repository.findListById(id)
    if (!list || (list.isPrivate && list.ownerId !== viewerId)) {
      throw new NotFoundError('list', id.toString())
    }
    return toDto(list)
  }

  async function requireOwnedList(id: bigint, requesterId: bigint): Promise<ListRow> {
    const list = await repository.findListById(id)
    if (!list) throw new NotFoundError('list', id.toString())
    if (list.ownerId !== requesterId) {
      throw new ForbiddenError('only the list owner can do this')
    }
    return list
  }

  async function update(
    id: bigint,
    requesterId: bigint,
    input: UpdateListServiceInput,
  ): Promise<ListDto> {
    await requireOwnedList(id, requesterId)
    const patch: ListPatch = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.description !== undefined) patch.description = input.description
    if (input.isPrivate !== undefined) patch.isPrivate = input.isPrivate
    if (Object.keys(patch).length > 0) {
      await repository.updateList(id, patch)
    }

    const updated = await repository.findListById(id)
    if (!updated) throw new NotFoundError('list', id.toString())
    return toDto(updated)
  }

  async function remove(id: bigint, requesterId: bigint): Promise<void> {
    await requireOwnedList(id, requesterId)
    await repository.deleteList(id)
  }

  async function addMember(listId: bigint, requesterId: bigint, userId: bigint): Promise<void> {
    await requireOwnedList(listId, requesterId)
    if (await repository.findMember(listId, userId)) {
      throw new ConflictError('user is already a member of this list')
    }
    await repository.insertMember(listId, userId)
  }

  /** Idempotent — removing someone who isn't a member is a no-op, matching unfollow/unmute's precedent. */
  async function removeMember(listId: bigint, requesterId: bigint, userId: bigint): Promise<void> {
    await requireOwnedList(listId, requesterId)
    await repository.deleteMember(listId, userId)
  }

  function toMemberDto(row: ListMemberRow): ListMemberDto {
    return {
      id: row.id.toString(),
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      isVerified: row.isVerified,
    }
  }

  /**
   * GET /lists/:id/members (ROADMAP.md 2.8) — same "a private list 404s for
   * anyone but its owner" visibility rule as getById/getTimeline above.
   */
  async function listMembers(
    listId: bigint,
    viewerId: bigint | undefined,
    limit: number,
    cursor: bigint | null,
  ): Promise<{ items: ListMemberDto[]; hasMore: boolean }> {
    const list = await repository.findListById(listId)
    if (!list || (list.isPrivate && list.ownerId !== viewerId)) {
      throw new NotFoundError('list', listId.toString())
    }
    const rows = await repository.findMembers(listId, limit + 1, cursor)
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    return { items: page.map(toMemberDto), hasMore }
  }

  async function listByOwner(
    usernameLower: string,
    limit: number,
    cursor: bigint | null,
    viewerId?: bigint,
  ): Promise<{ items: ListDto[]; hasMore: boolean }> {
    const ownerId = await repository.findUserIdByUsername(usernameLower)
    if (!ownerId) throw new NotFoundError('user', usernameLower)

    const rows = await repository.listByOwner(ownerId, limit + 1, cursor)
    // Someone else's private lists don't show up on their profile at all —
    // same visibility rule as getById, applied per-row instead of 404ing
    // the whole page (ROADMAP.md 2.8).
    const visible = rows.filter((row) => !row.isPrivate || row.ownerId === viewerId)
    const hasMore = visible.length > limit
    const page = visible.slice(0, limit)
    return { items: await Promise.all(page.map(toDto)), hasMore }
  }

  /**
   * GET /timeline/list/:id (ROADMAP.md 2.8) — member posts, cursor-paginated.
   * Blocks apply for free through postHydrator.getManyByIds, same as every
   * other list built on it. Muting applies too, same as the home timeline
   * (ROADMAP.md 2.6) — a list is still a scrollable, passive feed, unlike
   * bookmarks' deliberately-saved list, which skips it on purpose.
   */
  async function getTimeline(
    listId: bigint,
    viewerId: bigint | undefined,
    limit: number,
    cursor: bigint | null,
  ): Promise<{ items: Post[]; hasMore: boolean }> {
    const list = await repository.findListById(listId)
    if (!list || (list.isPrivate && list.ownerId !== viewerId)) {
      throw new NotFoundError('list', listId.toString())
    }

    const ids = await repository.findRecentPostsByMembers(listId, limit + 1, cursor)
    const hasMore = ids.length > limit
    const hydrated = await postHydrator.getManyByIds(ids.slice(0, limit), viewerId)
    const items =
      muteLookup && viewerId !== undefined
        ? await dropMuted(muteLookup, viewerId, hydrated)
        : hydrated
    return { items, hasMore }
  }

  return {
    create,
    getById,
    update,
    remove,
    addMember,
    removeMember,
    listMembers,
    listByOwner,
    getTimeline,
  }
}
