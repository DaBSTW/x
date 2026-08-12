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

// ROADMAP.md 2.6 "cuentas protegidas" — POST /users/:id/follow now needs to
// tell the caller which of the two actually happened.
export const followResponseSchema = z.object({
  data: z.object({ status: z.enum(['following', 'requested']) }),
})

// Same shape as followListItemSchema (requester profile fields) — a
// follow_requests row carries no data of its own worth exposing beyond who's asking.
export const followRequestListResponseSchema = paginatedResponseSchema(followListItemSchema)
