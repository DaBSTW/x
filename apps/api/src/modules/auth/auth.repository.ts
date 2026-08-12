import type { Database } from '@x/db'
import {
  type NewEmailVerificationToken,
  type NewPasswordResetToken,
  type NewRefreshToken,
  type NewTwoFactorChallenge,
  type NewUser,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
  twoFactorChallenges,
  twoFactorRecoveryCodes,
  twoFactorSecrets,
  userCounters,
  users,
} from '@x/db'
import { and, desc, eq, gt, isNotNull, isNull, ne } from 'drizzle-orm'

export type AuthRepository = ReturnType<typeof createAuthRepository>

/** Only Drizzle queries live here — no business rules (CODESTYLE.md §7). */
export function createAuthRepository(db: Database) {
  return {
    async findUserByEmail(email: string) {
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)))
        .limit(1)
      return user ?? null
    },

    async findUserByUsernameLower(usernameLower: string) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.usernameLower, usernameLower))
        .limit(1)
      return user ?? null
    },

    async findUserById(id: bigint) {
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1)
      return user ?? null
    },

    async insertUserWithCounters(newUser: NewUser): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.insert(users).values(newUser)
        await tx.insert(userCounters).values({ userId: newUser.id })
      })
    },

    async updatePasswordHash(userId: bigint, passwordHash: string): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, userId))
    },

    async insertEmailVerificationToken(row: NewEmailVerificationToken): Promise<void> {
      await db.insert(emailVerificationTokens).values(row)
    },

    async findEmailVerificationToken(tokenHash: string) {
      const [row] = await db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.tokenHash, tokenHash))
        .limit(1)
      return row ?? null
    },

    async markEmailVerified(userId: bigint, tokenHash: string): Promise<void> {
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ emailVerified: true, updatedAt: new Date() })
          .where(eq(users.id, userId))
        await tx
          .update(emailVerificationTokens)
          .set({ usedAt: new Date() })
          .where(eq(emailVerificationTokens.tokenHash, tokenHash))
      })
    },

    async insertPasswordResetToken(row: NewPasswordResetToken): Promise<void> {
      await db.insert(passwordResetTokens).values(row)
    },

    async findPasswordResetToken(tokenHash: string) {
      const [row] = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1)
      return row ?? null
    },

    /** Resetting a password also revokes every session (SPECS.md §13.2): a request that got this far had a valid token, but any live session could belong to whoever locked the account owner out in the first place. */
    async resetPasswordWithToken(
      userId: bigint,
      tokenHash: string,
      passwordHash: string,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(users.id, userId))
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(eq(passwordResetTokens.tokenHash, tokenHash))
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      })
    },

    async insertRefreshToken(row: NewRefreshToken): Promise<void> {
      await db.insert(refreshTokens).values(row)
    },

    async findRefreshTokenByHash(tokenHash: string) {
      const [row] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1)
      return row ?? null
    },

    /** Rotation: the used token is marked revoked and points at its replacement. */
    async rotateRefreshToken(oldTokenHash: string, newToken: NewRefreshToken): Promise<void> {
      await db.transaction(async (tx) => {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date(), replacedByHash: newToken.tokenHash })
          .where(eq(refreshTokens.tokenHash, oldTokenHash))
        await tx.insert(refreshTokens).values(newToken)
      })
    },

    /** Reuse detected, or explicit logout-all: revoke every live token in the family. */
    async revokeSession(sessionId: bigint): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.sessionId, sessionId), isNull(refreshTokens.revokedAt)))
    },

    async revokeAllSessionsForUser(userId: bigint): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    },

    /** Same as revokeAllSessionsForUser, but leaves one family alone — changePassword's "log out every other device, not this one" (unlike resetPassword's forgot-my-password flow, which has no session worth preserving). */
    async revokeAllSessionsForUserExcept(userId: bigint, exceptSessionId: bigint): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.userId, userId),
            isNull(refreshTokens.revokedAt),
            ne(refreshTokens.sessionId, exceptSessionId),
          ),
        )
    },

    async revokeToken(tokenHash: string): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, tokenHash))
    },

    /** ROADMAP.md 2.6: revocation of one session among the caller's own, scoped by userId so no one can revoke a session that isn't theirs by guessing an id. `false` when there was nothing of the caller's left to revoke — already revoked/expired, or the id belongs to someone else, or doesn't exist at all; the route can't and shouldn't distinguish those (session ids are opaque Snowflakes, not a name someone could otherwise enumerate). */
    async revokeSessionForUser(userId: bigint, sessionId: bigint): Promise<boolean> {
      const updated = await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.sessionId, sessionId),
            eq(refreshTokens.userId, userId),
            isNull(refreshTokens.revokedAt),
          ),
        )
        .returning({ id: refreshTokens.id })
      return updated.length > 0
    },

    /** One row per live session (family) — the newest token in each. */
    async listActiveSessions(userId: bigint) {
      return db
        .selectDistinctOn([refreshTokens.sessionId])
        .from(refreshTokens)
        .where(
          and(
            eq(refreshTokens.userId, userId),
            isNull(refreshTokens.revokedAt),
            gt(refreshTokens.expiresAt, new Date()),
          ),
        )
        .orderBy(refreshTokens.sessionId, desc(refreshTokens.createdAt))
    },

    /** POST /auth/2fa/setup (ROADMAP.md 2.6): upsert so re-running setup before ever confirming just replaces the pending secret, resetting confirmedAt/lastUsedTimeStep — the same "starting over is always safe" posture as re-requesting a password reset link. */
    async upsertTwoFactorSecret(userId: bigint, secret: string): Promise<void> {
      await db
        .insert(twoFactorSecrets)
        .values({ userId, secret })
        .onConflictDoUpdate({
          target: twoFactorSecrets.userId,
          set: { secret, confirmedAt: null, lastUsedTimeStep: null },
        })
    },

    async findTwoFactorSecret(userId: bigint) {
      const [row] = await db
        .select()
        .from(twoFactorSecrets)
        .where(eq(twoFactorSecrets.userId, userId))
        .limit(1)
      return row ?? null
    },

    /** Login only ever consults a *confirmed* secret — an in-progress, unverified setup() never gates a sign-in. */
    async findConfirmedTwoFactorSecret(userId: bigint) {
      const [row] = await db
        .select()
        .from(twoFactorSecrets)
        .where(and(eq(twoFactorSecrets.userId, userId), isNotNull(twoFactorSecrets.confirmedAt)))
        .limit(1)
      return row ?? null
    },

    async isTwoFactorEnabled(userId: bigint): Promise<boolean> {
      const [row] = await db
        .select({ userId: twoFactorSecrets.userId })
        .from(twoFactorSecrets)
        .where(and(eq(twoFactorSecrets.userId, userId), isNotNull(twoFactorSecrets.confirmedAt)))
        .limit(1)
      return row !== undefined
    },

    /**
     * POST /auth/2fa/verify succeeding: confirms the pending secret and
     * replaces any previous batch of recovery codes with a fresh one —
     * codes are only ever shown once, at this exact moment.
     *
     * Deliberately leaves `lastUsedTimeStep` at null rather than recording
     * the code that just confirmed setup: that code proved possession
     * while already authenticated, not a login, and this account's first
     * *real* login (loginWithTwoFactor) could land in the same 30-second
     * window — replay protection should guard reuse across logins, not
     * treat a legitimate first login as a replay of setup's confirmation.
     */
    async confirmTwoFactor(userId: bigint, recoveryCodeHashes: string[]): Promise<void> {
      await db.transaction(async (tx) => {
        await tx
          .update(twoFactorSecrets)
          .set({ confirmedAt: new Date() })
          .where(eq(twoFactorSecrets.userId, userId))
        await tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId))
        if (recoveryCodeHashes.length > 0) {
          await tx
            .insert(twoFactorRecoveryCodes)
            .values(recoveryCodeHashes.map((codeHash) => ({ codeHash, userId })))
        }
      })
    },

    async markTotpTimeStepUsed(userId: bigint, timeStep: number): Promise<void> {
      await db
        .update(twoFactorSecrets)
        .set({ lastUsedTimeStep: timeStep })
        .where(eq(twoFactorSecrets.userId, userId))
    },

    /** Atomic single-use spend, same `UPDATE ... RETURNING` shape as revokeSessionForUser: `true` only if this exact code existed for this user and hadn't already been spent. */
    async consumeRecoveryCode(userId: bigint, codeHash: string): Promise<boolean> {
      const updated = await db
        .update(twoFactorRecoveryCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(twoFactorRecoveryCodes.codeHash, codeHash),
            eq(twoFactorRecoveryCodes.userId, userId),
            isNull(twoFactorRecoveryCodes.usedAt),
          ),
        )
        .returning({ codeHash: twoFactorRecoveryCodes.codeHash })
      return updated.length > 0
    },

    /** Disabling 2FA (requires the current password — auth.service.ts) drops both the secret and every recovery code together; neither is useful without the other. */
    async deleteTwoFactor(userId: bigint): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.delete(twoFactorSecrets).where(eq(twoFactorSecrets.userId, userId))
        await tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId))
      })
    },

    async insertTwoFactorChallenge(row: NewTwoFactorChallenge): Promise<void> {
      await db.insert(twoFactorChallenges).values(row)
    },

    async findTwoFactorChallenge(tokenHash: string) {
      const [row] = await db
        .select()
        .from(twoFactorChallenges)
        .where(eq(twoFactorChallenges.tokenHash, tokenHash))
        .limit(1)
      return row ?? null
    },

    async markTwoFactorChallengeUsed(tokenHash: string): Promise<void> {
      await db
        .update(twoFactorChallenges)
        .set({ usedAt: new Date() })
        .where(eq(twoFactorChallenges.tokenHash, tokenHash))
    },
  }
}
