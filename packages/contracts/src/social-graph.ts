import { z } from 'zod'
import { paginatedResponseSchema } from './common.js'
import { userProfileSchema } from './user.js'

export const followListItemSchema = userProfileSchema.pick({
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  isVerified: true,
})
export type FollowListItem = z.infer<typeof followListItemSchema>

export const followListResponseSchema = paginatedResponseSchema(followListItemSchema)

// Not cursor-paginated like followListResponseSchema — "who to follow" is a
// bounded batch to refresh, not a feed (SPECS.md §5.4's /users/suggestions).
export const suggestionsResponseSchema = z.object({ data: z.array(followListItemSchema) })
