import { z } from 'zod'
import { snowflakeIdSchema } from './common.js'

// Matches the `username_format` check constraint in packages/db/src/schema/users.ts.
export const usernameSchema = z
  .string()
  .min(1)
  .max(15)
  .regex(/^[A-Za-z0-9_]+$/, 'usernames can only contain letters, digits and underscores')

export const passwordSchema = z.string().min(10, 'password must be at least 10 characters').max(256)

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
})
export type UserProfile = z.infer<typeof userProfileSchema>

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(160).optional(),
  location: z.string().max(30).optional(),
  websiteUrl: z.string().url().optional(),
  isProtected: z.boolean().optional(),
})
export type UpdateUserInput = z.infer<typeof updateUserSchema>
