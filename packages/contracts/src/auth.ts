import { z } from 'zod'
import { snowflakeIdSchema } from './common.js'
import { passwordSchema, usernameSchema } from './user.js'

export const registerRequestSchema = z.object({
  username: usernameSchema,
  email: z.string().email(),
  password: passwordSchema,
  // 13+ per SPECS.md §11.4 — enforced server-side against this value.
  birthDate: z.string().date(),
})
export type RegisterRequest = z.infer<typeof registerRequestSchema>

export const registerResponseSchema = z.object({
  data: z.object({
    id: snowflakeIdSchema,
    username: usernameSchema,
    email: z.string().email(),
    emailVerified: z.literal(false),
  }),
})
export type RegisterResponse = z.infer<typeof registerResponseSchema>

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

// The refresh token itself never appears in a JSON body — it travels only as
// an httpOnly cookie (SPECS.md §11.1).
export const tokenPairResponseSchema = z.object({
  data: z.object({
    accessToken: z.string(),
    expiresInSeconds: z.number().int().positive(),
  }),
})
export type TokenPairResponse = z.infer<typeof tokenPairResponseSchema>

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1),
})
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>

// SPECS.md §5.4 / §13.2: forgot/reset never reveals whether the email is
// registered — the response is the same generic shape either way.
export const forgotPasswordRequestSchema = z.object({
  email: z.string().email(),
})
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
})
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
})
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>

export const sessionSchema = z.object({
  id: snowflakeIdSchema,
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string().datetime(),
  isCurrent: z.boolean(),
})
export type Session = z.infer<typeof sessionSchema>

export const listSessionsResponseSchema = z.object({
  data: z.array(sessionSchema),
})
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>
