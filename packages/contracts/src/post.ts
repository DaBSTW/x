import { z } from 'zod'
import { paginatedResponseSchema, paginationQuerySchema, snowflakeIdSchema } from './common.js'
import { postMediaItemSchema } from './media.js'
import { userProfileSchema } from './user.js'

export const entityKindSchema = z.enum(['mention', 'hashtag', 'url', 'cashtag'])

export const postEntitySchema = z.object({
  kind: entityKindSchema,
  value: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
})
export type PostEntity = z.infer<typeof postEntitySchema>

// Text or media — ROADMAP.md 1.1's "texto o media obligatorio", now that
// media exists (1.5). 4 is @x/utils' MEDIA_LIMITS.MAX_ATTACHMENTS_PER_POST,
// duplicated as a literal the same way text's 280 duplicates MAX_POST_GRAPHEMES
// — contracts has no dependency on @x/utils.
export const createPostSchema = z
  .object({
    text: z.string().max(280).optional(),
    mediaIds: z.array(snowflakeIdSchema).max(4).optional(),
    inReplyToId: snowflakeIdSchema.optional(),
    quotedPostId: snowflakeIdSchema.optional(),
    replyPolicy: z.enum(['everyone', 'following', 'mentioned']).default('everyone'),
    isSensitive: z.boolean().default(false),
  })
  .refine((input) => Boolean(input.text?.trim()) || (input.mediaIds?.length ?? 0) > 0, {
    message: 'text or at least one media attachment is required',
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

export const viewerStateSchema = z.object({
  liked: z.boolean(),
  reposted: z.boolean(),
  bookmarked: z.boolean(),
})
export type ViewerState = z.infer<typeof viewerStateSchema>

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
  media: z.array(postMediaItemSchema),
  conversationId: snowflakeIdSchema,
  inReplyToId: snowflakeIdSchema.nullable(),
  counters: postCountersSchema,
  // Only populated where the caller's identity and a batch lookup are both
  // already in hand (GET /timeline/home) — absent elsewhere, not false;
  // the client should not treat a missing `viewer` as "definitely not liked".
  viewer: viewerStateSchema.optional(),
})
export type Post = z.infer<typeof postSchema>

export const postResponseSchema = z.object({ data: postSchema })
export const postListResponseSchema = paginatedResponseSchema(postSchema)

// GET /users/:username/posts's four tabs (ROADMAP.md 1.8, SPECS.md §7.2):
// posts/replies split on `kind`, media requires an attached row, likes goes
// through the `likes` table instead of authorship — see posts.repository.ts.
export const profilePostsFilterSchema = z.enum(['posts', 'replies', 'media', 'likes'])
export type ProfilePostsFilter = z.infer<typeof profilePostsFilterSchema>

export const profilePostsQuerySchema = paginationQuerySchema.extend({
  filter: profilePostsFilterSchema.default('posts'),
})
export type ProfilePostsQuery = z.infer<typeof profilePostsQuerySchema>

// GET /posts/:id/thread (ROADMAP.md 2.1): the ancestor chain root-first, the
// post itself, and its first page of direct replies (not cursor-paginated
// here — GET /posts/:id/replies covers "load more" beyond it).
export const postThreadResponseSchema = z.object({
  data: z.object({
    ancestors: z.array(postSchema),
    post: postSchema,
    replies: z.array(postSchema),
    meta: z.object({ hasMoreReplies: z.boolean() }),
  }),
})
