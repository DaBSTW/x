import type { z } from 'zod'
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
