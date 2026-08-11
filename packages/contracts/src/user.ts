import { z } from 'zod'
import { snowflakeIdSchema } from './common.js'

// Top-level static routes apps/web serves today or documents for the near
// future (ROADMAP.md) — a matching username would be permanently shadowed
// by Next.js's static-over-dynamic route resolution (a real profile at
// /:username would become unreachable) and is rejected before that can
// happen, not caught after the fact.
const RESERVED_USERNAMES = new Set([
  'home',
  'login',
  'signup',
  'logout',
  'settings',
  'notifications',
  'messages',
  'explore',
  'search',
  'bookmarks',
  'lists',
  'i',
  'intent',
  'about',
  'help',
  'terms',
  'privacy',
  'admin',
  'api',
  'app',
])

// Matches the `username_format` check constraint in packages/db/src/schema/users.ts.
export const usernameSchema = z
  .string()
  .min(1)
  .max(15)
  .regex(/^[A-Za-z0-9_]+$/, 'usernames can only contain letters, digits and underscores')
  .refine((value) => !RESERVED_USERNAMES.has(value.toLowerCase()), 'this username is reserved')

export const passwordSchema = z.string().min(10, 'password must be at least 10 characters').max(256)

export const userCountersSchema = z.object({
  followers: z.number().int().nonnegative(),
  following: z.number().int().nonnegative(),
  posts: z.number().int().nonnegative(),
})
export type UserCounters = z.infer<typeof userCountersSchema>

export const userProfileSchema = z.object({
  id: snowflakeIdSchema,
  username: usernameSchema,
  displayName: z.string().min(1).max(50),
  bio: z.string().max(160).nullable(),
  location: z.string().max(30).nullable(),
  websiteUrl: z.string().url().nullable(),
  avatarUrl: z.string().url().nullable(),
  bannerUrl: z.string().url().nullable(),
  isProtected: z.boolean(),
  isVerified: z.boolean(),
  createdAt: z.string().datetime(),
  counters: userCountersSchema,
})
export type UserProfile = z.infer<typeof userProfileSchema>

export const userProfileResponseSchema = z.object({ data: userProfileSchema })

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(160).optional(),
  location: z.string().max(30).optional(),
  websiteUrl: z.string().url().optional(),
  isProtected: z.boolean().optional(),
})
export type UpdateUserInput = z.infer<typeof updateUserSchema>
