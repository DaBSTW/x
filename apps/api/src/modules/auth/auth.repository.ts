import type { Database } from '@x/db'
import {
  type NewEmailVerificationToken,
  type NewRefreshToken,
  type NewUser,
  emailVerificationTokens,
  refreshTokens,
  userCounters,
  users,
} from '@x/db'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'

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

    async revokeToken(tokenHash: string): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, tokenHash))
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
  }
}
