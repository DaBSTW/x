import type { Conversation, ConversationMemberSummary, Message } from '@x/contracts'
import { ForbiddenError, NotFoundError, ValidationError, generateId } from '@x/utils'
import type { Redis } from 'ioredis'
import { enforceRateLimit } from '../../lib/rate-limit.js'
import type { ConversationsRepository, MemberRow } from './conversations.repository.js'

const DM_PRIVACY_CODES = { everyone: 0, following: 1 } as const
const MESSAGE_RATE_LIMIT = { limit: 500, windowMs: 24 * 60 * 60 * 1000 } // SPECS.md §5.5

/** Backs 1:1 creation's dm_privacy check — narrow on purpose, same posture as posts.service.ts's FollowLookup. */
export type FollowLookup = {
  isFollowing(followerId: bigint, followeeId: bigint): Promise<boolean>
}

export type BlockLookup = {
  findBlockedAuthorIds(viewerId: bigint, authorIds: bigint[]): Promise<Set<bigint>>
}

export type CreateConversationServiceInput = {
  memberIds: bigint[]
  isGroup: boolean
  name?: string | undefined
}

export type ConversationsService = ReturnType<typeof createConversationsService>

export function createConversationsService(
  repository: ConversationsRepository,
  redis: Redis,
  followLookup?: FollowLookup,
  blockLookup?: BlockLookup,
) {
  async function toConversationDto(
    conversation: {
      id: bigint
      isGroup: boolean
      name: string | null
      lastMessageAt: Date | null
      createdAt: Date
      lastReadId: bigint | null
    },
    members: MemberRow[],
    viewerId: bigint,
  ): Promise<Conversation> {
    const unreadCount = await repository.countUnread(
      conversation.id,
      conversation.lastReadId,
      viewerId,
    )
    return {
      id: conversation.id.toString(),
      isGroup: conversation.isGroup,
      name: conversation.name,
      members: members.map(toMemberSummary),
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      unreadCount,
      createdAt: conversation.createdAt.toISOString(),
    }
  }

  /** Creates a 1:1 or group conversation. A 1:1 reuses any existing thread between the same two people instead of duplicating it. */
  async function create(
    creatorId: bigint,
    input: CreateConversationServiceInput,
  ): Promise<Conversation> {
    const memberIds = [...new Set(input.memberIds)].filter((id) => id !== creatorId)
    if (memberIds.length === 0) {
      throw new ValidationError('a conversation needs at least one other member')
    }
    if (!input.isGroup && memberIds.length !== 1) {
      throw new ValidationError('a 1:1 conversation must have exactly one other member')
    }

    for (const id of memberIds) {
      if (!(await repository.userExists(id))) throw new NotFoundError('user', id.toString())
    }

    if (!input.isGroup) {
      const recipientId = memberIds[0]
      if (recipientId === undefined) throw new ValidationError('missing recipient')

      if ((await findBlockedIds(creatorId, [recipientId])).size > 0) {
        throw new ForbiddenError('cannot message a user you have blocked or who has blocked you')
      }
      if (!(await canMessage(creatorId, recipientId))) {
        throw new ForbiddenError('this user only accepts messages from accounts they follow')
      }

      const existingId = await repository.find1to1Conversation(creatorId, recipientId)
      if (existingId !== null) {
        return getById(existingId, creatorId)
      }
    }

    const id = generateId()
    await repository.insertConversation({
      id,
      isGroup: input.isGroup,
      name: input.name ?? null,
      createdBy: creatorId,
    })
    await repository.insertMembers(id, [creatorId, ...memberIds])

    return getById(id, creatorId)
  }

  async function getById(id: bigint, viewerId: bigint): Promise<Conversation> {
    const [conversation, member] = await Promise.all([
      repository.findConversationById(id),
      repository.findMember(id, viewerId),
    ])
    // A non-member gets the same 404 as a missing conversation — existence
    // of a DM thread isn't something to leak to someone outside it.
    if (!conversation || !member) throw new NotFoundError('conversation', id.toString())

    const members = await repository.findMembersForConversations([id])
    return toConversationDto({ ...conversation, lastReadId: member.lastReadId }, members, viewerId)
  }

  async function listConversations(
    userId: bigint,
    limit: number,
    cursor: bigint | null,
  ): Promise<{ items: Conversation[]; hasMore: boolean }> {
    const rows = await repository.listConversationsForUser(userId, limit + 1, cursor)
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const allMembers = await repository.findMembersForConversations(page.map((row) => row.id))
    const membersByConversation = groupBy(allMembers, (row) => row.conversationId)

    const items = await Promise.all(
      page.map((row) => toConversationDto(row, membersByConversation.get(row.id) ?? [], userId)),
    )
    return { items, hasMore }
  }

  async function requireMembership(conversationId: bigint, userId: bigint): Promise<void> {
    if (!(await repository.findMember(conversationId, userId))) {
      throw new NotFoundError('conversation', conversationId.toString())
    }
  }

  async function listMessages(
    conversationId: bigint,
    viewerId: bigint,
    limit: number,
    cursor: bigint | null,
  ): Promise<{ items: Message[]; hasMore: boolean }> {
    await requireMembership(conversationId, viewerId)

    const rows = await repository.listMessages(conversationId, limit + 1, cursor)
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    return { items: page.map(toMessageDto), hasMore }
  }

  async function sendMessage(
    conversationId: bigint,
    senderId: bigint,
    text: string,
  ): Promise<Message> {
    await requireMembership(conversationId, senderId)
    await enforceRateLimit(
      redis,
      `messages:user:${senderId}`,
      MESSAGE_RATE_LIMIT.limit,
      MESSAGE_RATE_LIMIT.windowMs,
    )

    const id = generateId()
    await repository.insertMessage({ id, conversationId, senderId, text })
    return {
      id: id.toString(),
      conversationId: conversationId.toString(),
      senderId: senderId.toString(),
      text,
      createdAt: new Date().toISOString(),
    }
  }

  async function markRead(
    conversationId: bigint,
    userId: bigint,
    messageId: bigint,
  ): Promise<void> {
    await requireMembership(conversationId, userId)
    await repository.updateLastRead(conversationId, userId, messageId)
  }

  async function findBlockedIds(viewerId: bigint, ids: bigint[]): Promise<Set<bigint>> {
    if (!blockLookup) return new Set()
    return blockLookup.findBlockedAuthorIds(viewerId, ids)
  }

  async function canMessage(senderId: bigint, recipientId: bigint): Promise<boolean> {
    const privacy = await repository.findDmPrivacy(recipientId)
    if (privacy !== DM_PRIVACY_CODES.following) return true
    if (!followLookup) return true
    return followLookup.isFollowing(recipientId, senderId)
  }

  return { create, getById, listConversations, listMessages, sendMessage, markRead }
}

function toMemberSummary(row: MemberRow): ConversationMemberSummary {
  return {
    id: row.id.toString(),
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    isVerified: row.isVerified,
  }
}

function toMessageDto(row: {
  id: bigint
  conversationId: bigint
  senderId: bigint
  text: string | null
  createdAt: Date
}): Message {
  return {
    id: row.id.toString(),
    conversationId: row.conversationId.toString(),
    senderId: row.senderId.toString(),
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  }
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const group = map.get(k)
    if (group) {
      group.push(item)
    } else {
      map.set(k, [item])
    }
  }
  return map
}
