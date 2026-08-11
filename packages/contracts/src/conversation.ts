import { z } from 'zod'
import { paginatedResponseSchema, snowflakeIdSchema } from './common.js'
import { userProfileSchema } from './user.js'

const conversationMemberSummarySchema = userProfileSchema.pick({
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  isVerified: true,
})
export type ConversationMemberSummary = z.infer<typeof conversationMemberSummarySchema>

export const createConversationSchema = z.object({
  memberIds: z.array(snowflakeIdSchema).min(1).max(50),
  isGroup: z.boolean().default(false),
  name: z.string().min(1).max(50).optional(),
})
export type CreateConversationInput = z.infer<typeof createConversationSchema>

export const conversationSchema = z.object({
  id: snowflakeIdSchema,
  isGroup: z.boolean(),
  name: z.string().nullable(),
  members: z.array(conversationMemberSummarySchema),
  lastMessageAt: z.string().datetime().nullable(),
  unreadCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
})
export type Conversation = z.infer<typeof conversationSchema>

export const conversationResponseSchema = z.object({ data: conversationSchema })
export const conversationListResponseSchema = paginatedResponseSchema(conversationSchema)

// Text-only for now — messages.media_id/shared_post_id exist in the schema
// (SPECS.md §4.2) but attaching either is out of scope for this checkpoint.
export const sendMessageSchema = z.object({
  text: z.string().min(1).max(10000),
})
export type SendMessageInput = z.infer<typeof sendMessageSchema>

export const messageSchema = z.object({
  id: snowflakeIdSchema,
  conversationId: snowflakeIdSchema,
  senderId: snowflakeIdSchema,
  text: z.string().nullable(),
  createdAt: z.string().datetime(),
})
export type Message = z.infer<typeof messageSchema>

export const messageListResponseSchema = paginatedResponseSchema(messageSchema)

export const markReadSchema = z.object({
  messageId: snowflakeIdSchema,
})
export type MarkReadInput = z.infer<typeof markReadSchema>
