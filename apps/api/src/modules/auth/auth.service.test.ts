import type { User } from '@x/db'
import { generateTotp, hashPassword } from '@x/utils'
import type { Redis } from 'ioredis'
import { describe, expect, it } from 'vitest'
import type { Mailer, SecurityAlertKind } from '../../lib/mailer.js'
import type { AccessTokenClaims, TokenService } from '../../plugins/tokens.js'
import type { AuthRepository } from './auth.repository.js'
import {
  type CreateAuthServiceOptions,
  type LoginResult,
  createAuthService,
} from './auth.service.js'

const META = { ipAddress: '127.0.0.1', userAgent: 'vitest' }

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1n,
    username: 'ana',
    usernameLower: 'ana',
    email: 'ana@example.com',
    emailVerified: false,
    passwordHash: null,
    displayName: 'Ana',
    bio: null,
    location: null,
    websiteUrl: null,
    avatarUrl: null,
    bannerUrl: null,
    birthDate: '1990-01-01',
    isProtected: false,
    dmPrivacy: 0,
    isVerified: false,
    isSuspended: false,
    readOnlyUntil: null,
    isBanned: false,
    isModerator: false,
    lang: 'es',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
}

// In-memory double of AuthRepository — the real Drizzle-backed repository is
// covered by the integration suite (auth.integration.test.ts) against real
// Postgres; this lets the service's business rules (rotation, reuse
// detection, enumeration resistance) be tested fast and in isolation.
function createFakeRepository() {
  const usersByEmail = new Map<string, User>()
  const usersById = new Map<bigint, User>()
  type FakeRefreshToken = {
    id: bigint
    userId: bigint
    sessionId: bigint
    tokenHash: string
    replacedByHash: string | null
    expiresAt: Date
    revokedAt: Date | null
    userAgent: string | null
    ipAddress: string | null
    createdAt: Date
  }
  const refreshTokensByHash = new Map<string, FakeRefreshToken>()
  const verificationTokens = new Map<
    string,
    { tokenHash: string; userId: bigint; createdAt: Date; expiresAt: Date; usedAt: Date | null }
  >()
  const resetTokens = new Map<
    string,
    { tokenHash: string; userId: bigint; createdAt: Date; expiresAt: Date; usedAt: Date | null }
  >()
  type FakeTwoFactorSecret = {
    userId: bigint
    secret: string
    createdAt: Date
    confirmedAt: Date | null
    lastUsedTimeStep: number | null
  }
  const twoFactorSecretsByUser = new Map<bigint, FakeTwoFactorSecret>()
  const recoveryCodesByHash = new Map<
    string,
    { codeHash: string; userId: bigint; usedAt: Date | null }
  >()
  const twoFactorChallengesByHash = new Map<
    string,
    { tokenHash: string; userId: bigint; createdAt: Date; expiresAt: Date; usedAt: Date | null }
  >()

  const repository: AuthRepository = {
    async findUserByEmail(email) {
      return usersByEmail.get(email) ?? null
    },
    async findUserByUsernameLower(usernameLower) {
      return [...usersByEmail.values()].find((user) => user.usernameLower === usernameLower) ?? null
    },
    async findUserById(id) {
      return usersById.get(id) ?? null
    },
    async insertUserWithCounters(newUser) {
      const user = makeUser(newUser as Partial<User>)
      usersByEmail.set(user.email, user)
      usersById.set(user.id, user)
    },
    async updatePasswordHash(userId, passwordHash) {
      const user = usersById.get(userId)
      if (user) user.passwordHash = passwordHash
    },
    async insertEmailVerificationToken(row) {
      verificationTokens.set(row.tokenHash, { ...row, createdAt: new Date(), usedAt: null })
    },
    async findEmailVerificationToken(tokenHash) {
      return verificationTokens.get(tokenHash) ?? null
    },
    async markEmailVerified(userId, tokenHash) {
      const user = usersById.get(userId)
      if (user) user.emailVerified = true
      const token = verificationTokens.get(tokenHash)
      if (token) token.usedAt = new Date()
    },
    async insertPasswordResetToken(row) {
      resetTokens.set(row.tokenHash, { ...row, createdAt: new Date(), usedAt: null })
    },
    async findPasswordResetToken(tokenHash) {
      return resetTokens.get(tokenHash) ?? null
    },
    async resetPasswordWithToken(userId, tokenHash, passwordHash) {
      const user = usersById.get(userId)
      if (user) user.passwordHash = passwordHash
      const token = resetTokens.get(tokenHash)
      if (token) token.usedAt = new Date()
      for (const refreshToken of refreshTokensByHash.values()) {
        if (refreshToken.userId === userId && !refreshToken.revokedAt) {
          refreshToken.revokedAt = new Date()
        }
      }
    },
    async insertRefreshToken(row) {
      refreshTokensByHash.set(row.tokenHash, {
        ...row,
        replacedByHash: row.replacedByHash ?? null,
        revokedAt: row.revokedAt ?? null,
        userAgent: row.userAgent ?? null,
        ipAddress: row.ipAddress ?? null,
        createdAt: new Date(),
      })
    },
    async findRefreshTokenByHash(tokenHash) {
      return refreshTokensByHash.get(tokenHash) ?? null
    },
    async rotateRefreshToken(oldTokenHash, newToken) {
      const old = refreshTokensByHash.get(oldTokenHash)
      if (old) old.revokedAt = new Date()
      refreshTokensByHash.set(newToken.tokenHash, {
        ...newToken,
        replacedByHash: newToken.replacedByHash ?? null,
        revokedAt: null,
        userAgent: newToken.userAgent ?? null,
        ipAddress: newToken.ipAddress ?? null,
        createdAt: new Date(),
      })
    },
    async revokeSession(sessionId) {
      for (const token of refreshTokensByHash.values()) {
        if (token.sessionId === sessionId && !token.revokedAt) token.revokedAt = new Date()
      }
    },
    async revokeAllSessionsForUser(userId) {
      for (const token of refreshTokensByHash.values()) {
        if (token.userId === userId && !token.revokedAt) token.revokedAt = new Date()
      }
    },
    async revokeAllSessionsForUserExcept(userId, exceptSessionId) {
      for (const token of refreshTokensByHash.values()) {
        if (token.userId === userId && token.sessionId !== exceptSessionId && !token.revokedAt) {
          token.revokedAt = new Date()
        }
      }
    },
    async revokeToken(tokenHash) {
      const token = refreshTokensByHash.get(tokenHash)
      if (token) token.revokedAt = new Date()
    },
    async revokeSessionForUser(userId, sessionId) {
      let revokedAny = false
      for (const token of refreshTokensByHash.values()) {
        if (token.userId === userId && token.sessionId === sessionId && !token.revokedAt) {
          token.revokedAt = new Date()
          revokedAny = true
        }
      }
      return revokedAny
    },
    async listActiveSessions(userId) {
      return [...refreshTokensByHash.values()].filter(
        (token) => token.userId === userId && !token.revokedAt && token.expiresAt > new Date(),
      )
    },
    async upsertTwoFactorSecret(userId, secret) {
      twoFactorSecretsByUser.set(userId, {
        userId,
        secret,
        createdAt: new Date(),
        confirmedAt: null,
        lastUsedTimeStep: null,
      })
    },
    async findTwoFactorSecret(userId) {
      return twoFactorSecretsByUser.get(userId) ?? null
    },
    async findConfirmedTwoFactorSecret(userId) {
      const row = twoFactorSecretsByUser.get(userId)
      return row?.confirmedAt ? row : null
    },
    async isTwoFactorEnabled(userId) {
      return twoFactorSecretsByUser.get(userId)?.confirmedAt != null
    },
    async confirmTwoFactor(userId, recoveryCodeHashes) {
      const row = twoFactorSecretsByUser.get(userId)
      if (row) row.confirmedAt = new Date()
      for (const [hash, code] of recoveryCodesByHash) {
        if (code.userId === userId) recoveryCodesByHash.delete(hash)
      }
      for (const codeHash of recoveryCodeHashes) {
        recoveryCodesByHash.set(codeHash, { codeHash, userId, usedAt: null })
      }
    },
    async markTotpTimeStepUsed(userId, timeStep) {
      const row = twoFactorSecretsByUser.get(userId)
      if (row) row.lastUsedTimeStep = timeStep
    },
    async consumeRecoveryCode(userId, codeHash) {
      const code = recoveryCodesByHash.get(codeHash)
      if (!code || code.userId !== userId || code.usedAt) return false
      code.usedAt = new Date()
      return true
    },
    async deleteTwoFactor(userId) {
      twoFactorSecretsByUser.delete(userId)
      for (const [hash, code] of recoveryCodesByHash) {
        if (code.userId === userId) recoveryCodesByHash.delete(hash)
      }
    },
    async insertTwoFactorChallenge(row) {
      twoFactorChallengesByHash.set(row.tokenHash, {
        ...row,
        createdAt: new Date(),
        usedAt: row.usedAt ?? null,
      })
    },
    async findTwoFactorChallenge(tokenHash) {
      return twoFactorChallengesByHash.get(tokenHash) ?? null
    },
    async markTwoFactorChallengeUsed(tokenHash) {
      const row = twoFactorChallengesByHash.get(tokenHash)
      if (row) row.usedAt = new Date()
    },
  }

  return repository
}

/** get/set/incr/expire/del only — the subset lib/rate-limit.ts's login-backoff functions actually call, same narrow-fake posture as this file's other collaborators. */
function createFakeRedis(): Redis {
  const store = new Map<string, string>()
  return {
    async get(key: string) {
      return store.get(key) ?? null
    },
    async set(key: string, value: string) {
      store.set(key, value)
      return 'OK'
    },
    async incr(key: string) {
      const next = Number(store.get(key) ?? '0') + 1
      store.set(key, String(next))
      return next
    },
    async expire() {
      return 1
    },
    async del(...keys: string[]) {
      let count = 0
      for (const key of keys) {
        if (store.delete(key)) count++
      }
      return count
    },
  } as unknown as Redis
}

function createFakeTokenService(): TokenService {
  const claimsByToken = new Map<string, AccessTokenClaims>()
  let counter = 0

  return {
    async signAccessToken(claims) {
      const token = `fake-access-token-${counter++}`
      claimsByToken.set(token, claims)
      return token
    },
    async verifyAccessToken(token) {
      const claims = claimsByToken.get(token)
      if (!claims) throw new Error('invalid token')
      return claims
    },
  }
}

type FakeMailer = Mailer & {
  sentTo: string[]
  sentTokens: string[]
  resetTokensSent: string[]
  securityAlerts: Array<{ to: string; kind: SecurityAlertKind }>
}

function createFakeMailer(): FakeMailer {
  const sentTo: string[] = []
  const sentTokens: string[] = []
  const resetTokensSent: string[] = []
  const securityAlerts: Array<{ to: string; kind: SecurityAlertKind }> = []
  return {
    sentTo,
    sentTokens,
    resetTokensSent,
    securityAlerts,
    async sendVerificationEmail(to, token) {
      sentTo.push(to)
      sentTokens.push(token)
    },
    async sendPasswordResetEmail(to, token) {
      sentTo.push(to)
      resetTokensSent.push(token)
    },
    async sendSecurityAlertEmail(to, kind) {
      securityAlerts.push({ to, kind })
    },
    async sendModerationActionEmail() {
      // ROADMAP.md 3.3 — no auth.service.ts test exercises this path (it's
      // moderation.service.ts's own send, not auth's); present only to
      // satisfy the Mailer interface this fake implements in full.
    },
  }
}

function createService(overrides: Partial<CreateAuthServiceOptions> = {}) {
  const repository = overrides.repository ?? createFakeRepository()
  const tokenService = overrides.tokenService ?? createFakeTokenService()
  const mailer = overrides.mailer ?? createFakeMailer()
  const redis = overrides.redis ?? createFakeRedis()
  // Real HIBP check hits the network — stub it out so unit tests stay hermetic;
  // isPasswordPwned itself is covered directly in packages/utils/src/hibp.test.ts.
  const checkPasswordPwned = overrides.checkPasswordPwned ?? (async () => false)

  return {
    service: createAuthService({
      repository,
      tokenService,
      logger: { warn: () => {} },
      checkPasswordPwned,
      mailer,
      redis,
      accessTtlMinutes: 15,
      refreshTokenTtlDays: 30,
      ...overrides,
    }),
    repository,
    tokenService,
    mailer,
    redis,
  }
}

/** Narrows a LoginResult to its 'authenticated' branch — every existing test logs into an account with 2FA off, where login() always takes this branch; the 2FA-specific describe blocks below test 'requires_two_factor' directly instead of through this helper. */
function expectAuthenticated(
  result: LoginResult,
): Extract<LoginResult, { status: 'authenticated' }> {
  if (result.status !== 'authenticated') {
    throw new Error(`expected an authenticated login, got status: ${result.status}`)
  }
  return result
}

describe('createAuthService', () => {
  describe('register', () => {
    it('creates the user and sends a verification email', async () => {
      const { service, mailer } = createService()

      const result = await service.register({
        username: 'ana',
        email: 'ana@example.com',
        password: 'correct horse battery staple',
        birthDate: '1990-01-01',
      })

      expect(result.emailVerified).toBe(false)
      expect((mailer as FakeMailer).sentTo).toEqual(['ana@example.com'])
    })

    it('rejects a duplicate email with ConflictError', async () => {
      const { service } = createService()
      const input = {
        username: 'ana',
        email: 'ana@example.com',
        password: 'correct horse battery staple',
        birthDate: '1990-01-01',
      }

      await service.register(input)
      await expect(service.register({ ...input, username: 'ana2' })).rejects.toMatchObject({
        code: 'CONFLICT',
      })
    })

    it('rejects a password found in the HIBP breach corpus', async () => {
      const { service } = createService({ checkPasswordPwned: async () => true })

      await expect(
        service.register({
          username: 'ana',
          email: 'ana@example.com',
          password: 'password123456',
          birthDate: '1990-01-01',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('proceeds with registration when the HIBP check itself fails (degrades gracefully)', async () => {
      const { service } = createService({
        checkPasswordPwned: async () => {
          throw new Error('HIBP unreachable')
        },
      })

      const result = await service.register({
        username: 'ana',
        email: 'ana@example.com',
        password: 'correct horse battery staple',
        birthDate: '1990-01-01',
      })

      expect(result.username).toBe('ana')
    })
  })

  describe('login', () => {
    it('rejects an unknown email without revealing that distinction', async () => {
      const { service } = createService()

      await expect(
        service.login({ email: 'ghost@example.com', password: 'anything' }, META),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    })

    it('rejects an incorrect password', async () => {
      const { service, repository } = createService()
      await repository.insertUserWithCounters(
        makeUser({
          email: 'ana@example.com',
          passwordHash: await hashPassword('the real password'),
        }),
      )

      await expect(
        service.login({ email: 'ana@example.com', password: 'wrong password' }, META),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    })

    it('issues a token pair for correct credentials', async () => {
      const { service, repository } = createService()
      await repository.insertUserWithCounters(
        makeUser({
          email: 'ana@example.com',
          passwordHash: await hashPassword('the real password'),
        }),
      )

      const tokens = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'the real password' }, META),
      )

      expect(tokens.accessToken).toBeTruthy()
      expect(tokens.refreshToken).toBeTruthy()
      expect(tokens.expiresInSeconds).toBe(15 * 60)
    })

    it('sends a non-optional "new login" security alert (SPECS.md §13.2)', async () => {
      const { service, repository, mailer } = createService()
      await repository.insertUserWithCounters(
        makeUser({
          email: 'ana@example.com',
          passwordHash: await hashPassword('the real password'),
        }),
      )

      await service.login({ email: 'ana@example.com', password: 'the real password' }, META)

      expect((mailer as FakeMailer).securityAlerts).toEqual([
        { to: 'ana@example.com', kind: 'new_login' },
      ])
    })
  })

  describe('refresh', () => {
    it('rotates the refresh token and keeps the same session', async () => {
      const { service, repository } = createService()
      await repository.insertUserWithCounters(
        makeUser({ email: 'ana@example.com', passwordHash: await hashPassword('password123456') }),
      )
      const { refreshToken } = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'password123456' }, META),
      )

      const rotated = await service.refresh(refreshToken, META)

      expect(rotated.refreshToken).not.toBe(refreshToken)
    })

    it('revokes the whole session on reuse of an already-rotated token', async () => {
      const { service, repository } = createService()
      await repository.insertUserWithCounters(
        makeUser({ email: 'ana@example.com', passwordHash: await hashPassword('password123456') }),
      )
      const { refreshToken } = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'password123456' }, META),
      )

      const rotated = await service.refresh(refreshToken, META)

      // Reusing the superseded token is rejected...
      await expect(service.refresh(refreshToken, META)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      })
      // ...and the family is dead: even the legitimately-rotated token no longer works.
      await expect(service.refresh(rotated.refreshToken, META)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      })
    })

    it('rejects an unknown refresh token', async () => {
      const { service } = createService()
      await expect(service.refresh('not-a-real-token', META)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      })
    })
  })

  describe('verifyEmail', () => {
    it('marks the user verified for a valid token', async () => {
      const { service, repository, mailer } = createService()
      await service.register({
        username: 'ana',
        email: 'ana@example.com',
        password: 'correct horse battery staple',
        birthDate: '1990-01-01',
      })
      const rawToken = lastSentToken(mailer as FakeMailer)

      await service.verifyEmail(rawToken)

      const user = await repository.findUserByEmail('ana@example.com')
      expect(user?.emailVerified).toBe(true)
    })

    it('rejects an already-used token', async () => {
      const { service, mailer } = createService()
      await service.register({
        username: 'ana',
        email: 'ana@example.com',
        password: 'correct horse battery staple',
        birthDate: '1990-01-01',
      })
      const rawToken = lastSentToken(mailer as FakeMailer)

      await service.verifyEmail(rawToken)
      await expect(service.verifyEmail(rawToken)).rejects.toMatchObject({ code: 'UNPROCESSABLE' })
    })

    it('rejects an unknown token', async () => {
      const { service } = createService()
      await expect(service.verifyEmail('not-a-real-token')).rejects.toMatchObject({
        code: 'UNPROCESSABLE',
      })
    })
  })

  describe('forgotPassword', () => {
    it('emails a reset link for a registered account', async () => {
      const { service, repository, mailer } = createService()
      await repository.insertUserWithCounters(makeUser({ email: 'ana@example.com' }))

      await service.forgotPassword('ana@example.com')

      expect((mailer as FakeMailer).sentTo).toEqual(['ana@example.com'])
    })

    it('resolves silently for an unknown email, without sending anything (SPECS.md §11.3)', async () => {
      const { service, mailer } = createService()

      await expect(service.forgotPassword('ghost@example.com')).resolves.toBeUndefined()

      expect((mailer as FakeMailer).sentTo).toEqual([])
    })
  })

  describe('resetPassword', () => {
    it('sets the new password, usable on the next login', async () => {
      const { service, repository, mailer } = createService()
      await repository.insertUserWithCounters(
        makeUser({ email: 'ana@example.com', passwordHash: await hashPassword('old password') }),
      )
      await service.forgotPassword('ana@example.com')
      const rawToken = (mailer as FakeMailer).resetTokensSent.at(-1)
      if (!rawToken) throw new Error('no reset token was sent')

      await service.resetPassword(rawToken, 'a brand new password', META)

      await expect(
        service.login({ email: 'ana@example.com', password: 'a brand new password' }, META),
      ).resolves.toBeDefined()
    })

    it('revokes every existing session', async () => {
      const { service, repository, mailer } = createService()
      await repository.insertUserWithCounters(
        makeUser({ email: 'ana@example.com', passwordHash: await hashPassword('old password') }),
      )
      const { refreshToken } = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'old password' }, META),
      )
      await service.forgotPassword('ana@example.com')
      const rawToken = (mailer as FakeMailer).resetTokensSent.at(-1)
      if (!rawToken) throw new Error('no reset token was sent')

      await service.resetPassword(rawToken, 'a brand new password', META)

      await expect(service.refresh(refreshToken, META)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      })
    })

    it('sends a "password changed" security alert', async () => {
      const { service, repository, mailer } = createService()
      await repository.insertUserWithCounters(makeUser({ email: 'ana@example.com' }))
      await service.forgotPassword('ana@example.com')
      const rawToken = (mailer as FakeMailer).resetTokensSent.at(-1)
      if (!rawToken) throw new Error('no reset token was sent')

      await service.resetPassword(rawToken, 'a brand new password', META)

      expect((mailer as FakeMailer).securityAlerts).toContainEqual({
        to: 'ana@example.com',
        kind: 'password_changed',
      })
    })

    it('rejects an unknown or already-used token', async () => {
      const { service } = createService()
      await expect(
        service.resetPassword('not-a-real-token', 'a brand new password', META),
      ).rejects.toMatchObject({ code: 'UNPROCESSABLE' })
    })
  })

  describe('changePassword', () => {
    it('updates the password when the current one is correct', async () => {
      const { service, repository } = createService()
      await repository.insertUserWithCounters(
        makeUser({
          id: 1n,
          email: 'ana@example.com',
          passwordHash: await hashPassword('old password'),
        }),
      )

      await service.changePassword(
        1n,
        999n,
        { currentPassword: 'old password', newPassword: 'a brand new password' },
        META,
      )

      await expect(
        service.login({ email: 'ana@example.com', password: 'a brand new password' }, META),
      ).resolves.toBeDefined()
    })

    it('rejects an incorrect current password', async () => {
      const { service, repository } = createService()
      await repository.insertUserWithCounters(
        makeUser({
          id: 1n,
          email: 'ana@example.com',
          passwordHash: await hashPassword('old password'),
        }),
      )

      await expect(
        service.changePassword(
          1n,
          999n,
          { currentPassword: 'wrong password', newPassword: 'a brand new password' },
          META,
        ),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    })

    it('logs out every other session but keeps the current one', async () => {
      const { service, repository, tokenService } = createService()
      await repository.insertUserWithCounters(
        makeUser({
          id: 1n,
          email: 'ana@example.com',
          passwordHash: await hashPassword('old password'),
        }),
      )
      const currentSession = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'old password' }, META),
      )
      const otherSession = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'old password' }, META),
      )
      const { sid } = await tokenService.verifyAccessToken(currentSession.accessToken)

      await service.changePassword(
        1n,
        BigInt(sid),
        { currentPassword: 'old password', newPassword: 'a brand new password' },
        META,
      )

      await expect(service.refresh(currentSession.refreshToken, META)).resolves.toBeDefined()
      await expect(service.refresh(otherSession.refreshToken, META)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      })
    })
  })

  describe('logout / logoutAll', () => {
    it('logout revokes only the presented session', async () => {
      const { service, repository } = createService()
      await repository.insertUserWithCounters(
        makeUser({ email: 'ana@example.com', passwordHash: await hashPassword('password123456') }),
      )
      const tokensA = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'password123456' }, META),
      )
      const tokensB = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'password123456' }, META),
      )

      await service.logout(tokensA.refreshToken)

      await expect(service.refresh(tokensA.refreshToken, META)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      })
      await expect(service.refresh(tokensB.refreshToken, META)).resolves.toBeTruthy()
    })

    it('logoutAll revokes every session for the user', async () => {
      const { service, repository } = createService()
      await repository.insertUserWithCounters(
        makeUser({
          id: 42n,
          email: 'ana@example.com',
          passwordHash: await hashPassword('password123456'),
        }),
      )
      const tokensA = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'password123456' }, META),
      )
      const tokensB = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'password123456' }, META),
      )

      await service.logoutAll(42n)

      await expect(service.refresh(tokensA.refreshToken, META)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      })
      await expect(service.refresh(tokensB.refreshToken, META)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      })
    })
  })

  describe('listSessions', () => {
    it('marks the current session and lists the rest', async () => {
      const { service, repository, tokenService } = createService()
      await repository.insertUserWithCounters(
        makeUser({
          id: 7n,
          email: 'ana@example.com',
          passwordHash: await hashPassword('password123456'),
        }),
      )
      const tokens = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'password123456' }, META),
      )
      const claims = await tokenService.verifyAccessToken(tokens.accessToken)

      const sessions = await service.listSessions(7n, BigInt(claims.sid))

      expect(sessions).toHaveLength(1)
      expect(sessions[0]?.isCurrent).toBe(true)
    })
  })

  describe('revokeSession', () => {
    it("revokes exactly the targeted session, leaving the caller's other sessions alone", async () => {
      const { service, repository, tokenService } = createService()
      await repository.insertUserWithCounters(
        makeUser({
          id: 1n,
          email: 'ana@example.com',
          passwordHash: await hashPassword('password123456'),
        }),
      )
      const sessionA = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'password123456' }, META),
      )
      const sessionB = expectAuthenticated(
        await service.login({ email: 'ana@example.com', password: 'password123456' }, META),
      )
      const { sid } = await tokenService.verifyAccessToken(sessionA.accessToken)

      await service.revokeSession(1n, BigInt(sid))

      await expect(service.refresh(sessionA.refreshToken, META)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      })
      await expect(service.refresh(sessionB.refreshToken, META)).resolves.toBeDefined()
    })

    it("throws NotFoundError when the session id belongs to someone else's account", async () => {
      const { service, repository, tokenService } = createService()
      await repository.insertUserWithCounters(
        makeUser({
          id: 1n,
          email: 'ana@example.com',
          passwordHash: await hashPassword('password123456'),
        }),
      )
      await repository.insertUserWithCounters(
        makeUser({
          id: 2n,
          username: 'bob',
          usernameLower: 'bob',
          email: 'bob@example.com',
          passwordHash: await hashPassword('password123456'),
        }),
      )
      const bobSession = expectAuthenticated(
        await service.login({ email: 'bob@example.com', password: 'password123456' }, META),
      )
      const { sid } = await tokenService.verifyAccessToken(bobSession.accessToken)

      await expect(service.revokeSession(1n, BigInt(sid))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
      // Untouched — the attempt from the wrong account had no effect.
      await expect(service.refresh(bobSession.refreshToken, META)).resolves.toBeDefined()
    })

    it('throws NotFoundError for a session id that does not exist', async () => {
      const { service, repository } = createService()
      await repository.insertUserWithCounters(makeUser({ id: 1n }))

      await expect(service.revokeSession(1n, 999999n)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })
  })

  describe('two-factor authentication (ROADMAP.md 2.6)', () => {
    describe('setupTwoFactor', () => {
      it('returns a secret, an otpauth URI carrying it, and a QR code data URL', async () => {
        const { service, repository } = createService()
        await repository.insertUserWithCounters(makeUser({ id: 1n }))

        const setup = await service.setupTwoFactor(1n)

        expect(setup.secret).toBeTruthy()
        expect(setup.otpauthUrl).toContain(setup.secret)
        expect(setup.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/)
      })

      it("doesn't enable 2FA on its own — login still succeeds with no code", async () => {
        const { service, repository } = createService()
        await repository.insertUserWithCounters(
          makeUser({
            id: 1n,
            email: 'ana@example.com',
            passwordHash: await hashPassword('password123456'),
          }),
        )

        await service.setupTwoFactor(1n)
        const result = await service.login(
          { email: 'ana@example.com', password: 'password123456' },
          META,
        )

        expect(result.status).toBe('authenticated')
      })
    })

    describe('verifyTwoFactor', () => {
      it('confirms 2FA and returns 10 recovery codes for a correct code', async () => {
        const { service, repository } = createService()
        await repository.insertUserWithCounters(makeUser({ id: 1n }))
        const setup = await service.setupTwoFactor(1n)

        const recoveryCodes = await service.verifyTwoFactor(
          1n,
          await generateTotp(setup.secret),
          META,
        )

        expect(recoveryCodes).toHaveLength(10)
        expect(await service.getTwoFactorStatus(1n)).toBe(true)
      })

      it('sends a "two_factor_enabled" security alert', async () => {
        const { service, repository, mailer } = createService()
        await repository.insertUserWithCounters(makeUser({ id: 1n, email: 'ana@example.com' }))
        const setup = await service.setupTwoFactor(1n)

        await service.verifyTwoFactor(1n, await generateTotp(setup.secret), META)

        expect((mailer as FakeMailer).securityAlerts).toContainEqual({
          to: 'ana@example.com',
          kind: 'two_factor_enabled',
        })
      })

      it('rejects an incorrect code without enabling 2FA', async () => {
        const { service, repository } = createService()
        await repository.insertUserWithCounters(makeUser({ id: 1n }))
        await service.setupTwoFactor(1n)

        await expect(service.verifyTwoFactor(1n, '000000', META)).rejects.toMatchObject({
          code: 'UNAUTHENTICATED',
        })
        expect(await service.getTwoFactorStatus(1n)).toBe(false)
      })

      it('rejects verifying with no setup in progress', async () => {
        const { service, repository } = createService()
        await repository.insertUserWithCounters(makeUser({ id: 1n }))

        await expect(service.verifyTwoFactor(1n, '123456', META)).rejects.toMatchObject({
          code: 'UNPROCESSABLE',
        })
      })
    })

    describe('login with 2FA enabled', () => {
      it('returns requires_two_factor with a challenge token instead of a session', async () => {
        const { service, repository } = createService()
        await repository.insertUserWithCounters(
          makeUser({
            id: 1n,
            email: 'ana@example.com',
            passwordHash: await hashPassword('password123456'),
          }),
        )
        const setup = await service.setupTwoFactor(1n)
        await service.verifyTwoFactor(1n, await generateTotp(setup.secret), META)

        const result = await service.login(
          { email: 'ana@example.com', password: 'password123456' },
          META,
        )

        expect(result.status).toBe('requires_two_factor')
        if (result.status !== 'requires_two_factor') throw new Error('unreachable')
        expect(result.challengeToken).toBeTruthy()
      })
    })

    describe('loginWithTwoFactor', () => {
      async function loginToChallenge(
        service: ReturnType<typeof createService>['service'],
        repository: AuthRepository,
      ) {
        await repository.insertUserWithCounters(
          makeUser({
            id: 1n,
            email: 'ana@example.com',
            passwordHash: await hashPassword('password123456'),
          }),
        )
        const setup = await service.setupTwoFactor(1n)
        const recoveryCodes = await service.verifyTwoFactor(
          1n,
          await generateTotp(setup.secret),
          META,
        )
        const result = await service.login(
          { email: 'ana@example.com', password: 'password123456' },
          META,
        )
        if (result.status !== 'requires_two_factor') throw new Error('expected requires_two_factor')
        return { secret: setup.secret, recoveryCodes, challengeToken: result.challengeToken }
      }

      it('completes login with a correct TOTP code', async () => {
        const { service, repository } = createService()
        const { secret, challengeToken } = await loginToChallenge(service, repository)

        const tokens = await service.loginWithTwoFactor(
          challengeToken,
          await generateTotp(secret),
          META,
        )

        expect(tokens.accessToken).toBeTruthy()
      })

      it('completes login with a recovery code, consuming it', async () => {
        const { service, repository } = createService()
        const { recoveryCodes, challengeToken } = await loginToChallenge(service, repository)
        const recoveryCode = recoveryCodes[0]
        if (!recoveryCode) throw new Error('expected at least one recovery code')

        await service.loginWithTwoFactor(challengeToken, recoveryCode, META)

        // The same recovery code can't complete a second login.
        const secondResult = await service.login(
          { email: 'ana@example.com', password: 'password123456' },
          META,
        )
        if (secondResult.status !== 'requires_two_factor') {
          throw new Error('expected requires_two_factor')
        }
        await expect(
          service.loginWithTwoFactor(secondResult.challengeToken, recoveryCode, META),
        ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
      })

      it('sends a "new login" security alert once 2FA completes, not at the password step', async () => {
        const { service, repository, mailer } = createService()
        const { secret, challengeToken } = await loginToChallenge(service, repository)
        const mailerDouble = mailer as FakeMailer
        mailerDouble.securityAlerts.length = 0 // drop the "two_factor_enabled" alert from setup

        await service.loginWithTwoFactor(challengeToken, await generateTotp(secret), META)

        expect(mailerDouble.securityAlerts).toEqual([{ to: 'ana@example.com', kind: 'new_login' }])
      })

      it('rejects an incorrect code', async () => {
        const { service, repository } = createService()
        const { challengeToken } = await loginToChallenge(service, repository)

        await expect(
          service.loginWithTwoFactor(challengeToken, '000000', META),
        ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
      })

      it('rejects reusing an already-completed challenge token', async () => {
        const { service, repository } = createService()
        const { secret, challengeToken } = await loginToChallenge(service, repository)
        await service.loginWithTwoFactor(challengeToken, await generateTotp(secret), META)

        await expect(
          service.loginWithTwoFactor(challengeToken, await generateTotp(secret), META),
        ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
      })

      it('rejects an unknown challenge token', async () => {
        const { service } = createService()

        await expect(
          service.loginWithTwoFactor('not-a-real-challenge', '123456', META),
        ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
      })
    })

    describe('getTwoFactorStatus', () => {
      it('is false for an account that never set up 2FA', async () => {
        const { service, repository } = createService()
        await repository.insertUserWithCounters(makeUser({ id: 1n }))

        expect(await service.getTwoFactorStatus(1n)).toBe(false)
      })
    })

    describe('disableTwoFactor', () => {
      it('removes 2FA so login stops requiring a code', async () => {
        const { service, repository } = createService()
        await repository.insertUserWithCounters(
          makeUser({
            id: 1n,
            email: 'ana@example.com',
            passwordHash: await hashPassword('password123456'),
          }),
        )
        const setup = await service.setupTwoFactor(1n)
        await service.verifyTwoFactor(1n, await generateTotp(setup.secret), META)

        await service.disableTwoFactor(1n, 'password123456')

        expect(await service.getTwoFactorStatus(1n)).toBe(false)
        const result = await service.login(
          { email: 'ana@example.com', password: 'password123456' },
          META,
        )
        expect(result.status).toBe('authenticated')
      })

      it('rejects an incorrect current password, leaving 2FA enabled', async () => {
        const { service, repository } = createService()
        await repository.insertUserWithCounters(
          makeUser({
            id: 1n,
            email: 'ana@example.com',
            passwordHash: await hashPassword('password123456'),
          }),
        )
        const setup = await service.setupTwoFactor(1n)
        await service.verifyTwoFactor(1n, await generateTotp(setup.secret), META)

        await expect(service.disableTwoFactor(1n, 'wrong password')).rejects.toMatchObject({
          code: 'UNAUTHENTICATED',
        })
        expect(await service.getTwoFactorStatus(1n)).toBe(true)
      })
    })
  })
})

function lastSentToken(mailer: FakeMailer): string {
  const token = mailer.sentTokens.at(-1)
  if (!token) throw new Error('fake mailer received no verification email')
  return token
}
