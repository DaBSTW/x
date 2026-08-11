import type { User } from '@x/db'
import { hashPassword } from '@x/utils'
import { describe, expect, it } from 'vitest'
import type { Mailer } from '../../lib/mailer.js'
import type { AccessTokenClaims, TokenService } from '../../plugins/tokens.js'
import type { AuthRepository } from './auth.repository.js'
import { type CreateAuthServiceOptions, createAuthService } from './auth.service.js'

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
    async revokeToken(tokenHash) {
      const token = refreshTokensByHash.get(tokenHash)
      if (token) token.revokedAt = new Date()
    },
    async listActiveSessions(userId) {
      return [...refreshTokensByHash.values()].filter(
        (token) => token.userId === userId && !token.revokedAt && token.expiresAt > new Date(),
      )
    },
  }

  return repository
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

type FakeMailer = Mailer & { sentTo: string[]; sentTokens: string[] }

function createFakeMailer(): FakeMailer {
  const sentTo: string[] = []
  const sentTokens: string[] = []
  return {
    sentTo,
    sentTokens,
    async sendVerificationEmail(to, token) {
      sentTo.push(to)
      sentTokens.push(token)
    },
  }
}

function createService(overrides: Partial<CreateAuthServiceOptions> = {}) {
  const repository = overrides.repository ?? createFakeRepository()
  const tokenService = overrides.tokenService ?? createFakeTokenService()
  const mailer = overrides.mailer ?? createFakeMailer()
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
      accessTtlMinutes: 15,
      refreshTokenTtlDays: 30,
      ...overrides,
    }),
    repository,
    tokenService,
    mailer,
  }
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

      const tokens = await service.login(
        { email: 'ana@example.com', password: 'the real password' },
        META,
      )

      expect(tokens.accessToken).toBeTruthy()
      expect(tokens.refreshToken).toBeTruthy()
      expect(tokens.expiresInSeconds).toBe(15 * 60)
    })
  })

  describe('refresh', () => {
    it('rotates the refresh token and keeps the same session', async () => {
      const { service, repository } = createService()
      await repository.insertUserWithCounters(
        makeUser({ email: 'ana@example.com', passwordHash: await hashPassword('password123456') }),
      )
      const { refreshToken } = await service.login(
        { email: 'ana@example.com', password: 'password123456' },
        META,
      )

      const rotated = await service.refresh(refreshToken, META)

      expect(rotated.refreshToken).not.toBe(refreshToken)
    })

    it('revokes the whole session on reuse of an already-rotated token', async () => {
      const { service, repository } = createService()
      await repository.insertUserWithCounters(
        makeUser({ email: 'ana@example.com', passwordHash: await hashPassword('password123456') }),
      )
      const { refreshToken } = await service.login(
        { email: 'ana@example.com', password: 'password123456' },
        META,
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

  describe('logout / logoutAll', () => {
    it('logout revokes only the presented session', async () => {
      const { service, repository } = createService()
      await repository.insertUserWithCounters(
        makeUser({ email: 'ana@example.com', passwordHash: await hashPassword('password123456') }),
      )
      const tokensA = await service.login(
        { email: 'ana@example.com', password: 'password123456' },
        META,
      )
      const tokensB = await service.login(
        { email: 'ana@example.com', password: 'password123456' },
        META,
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
      const tokensA = await service.login(
        { email: 'ana@example.com', password: 'password123456' },
        META,
      )
      const tokensB = await service.login(
        { email: 'ana@example.com', password: 'password123456' },
        META,
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
      const tokens = await service.login(
        { email: 'ana@example.com', password: 'password123456' },
        META,
      )
      const claims = await tokenService.verifyAccessToken(tokens.accessToken)

      const sessions = await service.listSessions(7n, BigInt(claims.sid))

      expect(sessions).toHaveLength(1)
      expect(sessions[0]?.isCurrent).toBe(true)
    })
  })
})

function lastSentToken(mailer: FakeMailer): string {
  const token = mailer.sentTokens.at(-1)
  if (!token) throw new Error('fake mailer received no verification email')
  return token
}
