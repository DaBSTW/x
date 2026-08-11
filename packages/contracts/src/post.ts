import { z } from 'zod'
import { paginatedResponseSchema, snowflakeIdSchema } from './common.js'
import { userProfileSchema } from './user.js'

export const entityKindSchema = z.enum(['mention', 'hashtag', 'url', 'cashtag'])

export const postEntitySchema = z.object({
  kind: entityKindSchema,
  value: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
})

// Text is optional at the schema level — createPostSchema's refine enforces
// "text or media" (ROADMAP.md 1.1); media isn't implemented until 1.5, so
// today text is effectively required.
export const createPostSchema = z
  .object({
    text: z.string().max(280).optional(),
    inReplyToId: snowflakeIdSchema.optional(),
    quotedPostId: snowflakeIdSchema.optional(),
    replyPolicy: z.enum(['everyone', 'following', 'mentioned']).default('everyone'),
    isSensitive: z.boolean().default(false),
  })
  .refine((input) => Boolean(input.text?.trim()), {
    message: 'text is required (media attachments land in a later phase)',
    path: ['text'],
  })
export type CreatePostInput = z.infer<typeof createPostSchema>

export const postCountersSchema = z.object({
  likes: z.number().int().nonnegative(),
  reposts: z.number().int().nonnegative(),
  replies: z.number().int().nonnegative(),
  quotes: z.number().int().nonnegative(),
  views: z.number().int().nonnegative(),
})

export const postSchema = z.object({
  id: snowflakeIdSchema,
  text: z.string().nullable(),
  createdAt: z.string().datetime(),
  author: userProfileSchema.pick({
    id: true,
    username: true,
    displayName: true,
    avatarUrl: true,
    isVerified: true,
  }),
  entities: z.array(postEntitySchema),
  conversationId: snowflakeIdSchema,
  inReplyToId: snowflakeIdSchema.nullable(),
  counters: postCountersSchema,
})
export type Post = z.infer<typeof postSchema>

export const postResponseSchema = z.object({ data: postSchema })
export const postListResponseSchema = paginatedResponseSchema(postSchema)
