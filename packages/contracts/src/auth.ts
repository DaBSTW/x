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

// POST /auth/login (ROADMAP.md 2.6): a password check that succeeds on an
// account with 2FA on doesn't get a session yet — 'requires_two_factor'
// carries a short-lived challengeToken for POST /auth/2fa/login instead of
// the real tokens 'authenticated' carries. A discriminated union (not a
// nullable accessToken) so a client can't forget to check for the pending
// case; TypeScript won't let it read accessToken without narrowing status first.
export const loginResponseSchema = z.object({
  data: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('authenticated'),
      accessToken: z.string(),
      expiresInSeconds: z.number().int().positive(),
    }),
    z.object({
      status: z.literal('requires_two_factor'),
      challengeToken: z.string(),
    }),
  ]),
})
export type LoginResponse = z.infer<typeof loginResponseSchema>

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

// POST /auth/2fa/setup (ROADMAP.md 2.6): a fresh secret, awaiting
// confirmation via POST /auth/2fa/verify. otpauthUrl is what qrCodeDataUrl
// (a data: URI PNG) encodes — kept in the response too so a client without
// a camera-scanning flow could still let someone type the secret in by hand.
export const setupTwoFactorResponseSchema = z.object({
  data: z.object({
    secret: z.string(),
    otpauthUrl: z.string(),
    qrCodeDataUrl: z.string(),
  }),
})
export type SetupTwoFactorResponse = z.infer<typeof setupTwoFactorResponseSchema>

export const verifyTwoFactorRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'must be a 6-digit code'),
})
export type VerifyTwoFactorRequest = z.infer<typeof verifyTwoFactorRequestSchema>

// Shown exactly once — the server only ever stores their hashes from here on.
export const verifyTwoFactorResponseSchema = z.object({
  data: z.object({ recoveryCodes: z.array(z.string()) }),
})
export type VerifyTwoFactorResponse = z.infer<typeof verifyTwoFactorResponseSchema>

export const twoFactorStatusResponseSchema = z.object({
  data: z.object({ enabled: z.boolean() }),
})
export type TwoFactorStatusResponse = z.infer<typeof twoFactorStatusResponseSchema>

export const disableTwoFactorRequestSchema = z.object({
  currentPassword: z.string().min(1),
})
export type DisableTwoFactorRequest = z.infer<typeof disableTwoFactorRequestSchema>

// code accepts either a live 6-digit TOTP code or a recovery code
// (xxxxxxxxxx-xxxxxxxxxx) — kept as a plain non-empty string rather than a
// stricter pattern so the service, not the wire schema, decides which kind
// it's looking at (same posture as loginRequestSchema's bare password).
export const twoFactorLoginRequestSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(1),
})
export type TwoFactorLoginRequest = z.infer<typeof twoFactorLoginRequestSchema>

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
