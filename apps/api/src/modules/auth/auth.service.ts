import {
  ConflictError,
  UnauthenticatedError,
  UnprocessableError,
  ValidationError,
  generateId,
  generateOpaqueToken,
  hashPassword,
  isPasswordPwned,
  needsRehash,
  sha256Hex,
  verifyPassword,
} from '@x/utils'
import type { Mailer, MailerLogger } from '../../lib/mailer.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { AuthRepository } from './auth.repository.js'

export type RegisterInput = {
  username: string
  email: string
  password: string
  birthDate: string
}

export type LoginInput = {
  email: string
  password: string
}

export type RequestMeta = {
  ipAddress: string | null
  userAgent: string | null
}

export type TokenPair = {
  accessToken: string
  expiresInSeconds: number
  refreshToken: string
}

export type CreateAuthServiceOptions = {
  repository: AuthRepository
  tokenService: TokenService
  mailer: Mailer
  logger: MailerLogger
  accessTtlMinutes: number
  refreshTokenTtlDays: number
  /** Injectable for tests — defaults to the real HIBP k-anonymity check. */
  checkPasswordPwned?: (password: string) => Promise<boolean>
}

const EMAIL_VERIFICATION_TTL_HOURS = 24
// Shorter than email verification — a live reset link is more sensitive
// than a pending signup, so it stays valid for less time.
const PASSWORD_RESET_TTL_HOURS = 1
// A precomputed hash spends the same Argon2id time as a real lookup would,
// so a login for a nonexistent account isn't distinguishable by timing —
// SPECS.md §11.3 "enumeración de cuentas".
const dummyPasswordHashPromise = hashPassword('correct horse battery staple placeholder')

export type AuthService = ReturnType<typeof createAuthService>

export function createAuthService(options: CreateAuthServiceOptions) {
  const {
    repository,
    tokenService,
    mailer,
    logger,
    accessTtlMinutes,
    refreshTokenTtlDays,
    checkPasswordPwned = isPasswordPwned,
  } = options

  async function register(input: RegisterInput) {
    const [existingEmail, existingUsername] = await Promise.all([
      repository.findUserByEmail(input.email),
      repository.findUserByUsernameLower(input.username.toLowerCase()),
    ])
    if (existingEmail) throw new ConflictError('email is already registered', { field: 'email' })
    if (existingUsername)
      throw new ConflictError('username is already taken', { field: 'username' })

    await assertPasswordNotPwned(input.password)

    const userId = generateId()
    const passwordHash = await hashPassword(input.password)

    await repository.insertUserWithCounters({
      id: userId,
      username: input.username,
      usernameLower: input.username.toLowerCase(),
      email: input.email,
      passwordHash,
      displayName: input.username,
      birthDate: input.birthDate,
    })

    await issueEmailVerificationToken(userId, input.email)

    return {
      id: userId,
      username: input.username,
      email: input.email,
      emailVerified: false as const,
    }
  }

  /**
   * SPECS.md §11.2: reject a password known to be in a public breach corpus.
   * A check that fails to *run* (HIBP unreachable/timeout) is not the same as
   * "not pwned" — it's logged and registration proceeds, since a third-party
   * outage on this one signal shouldn't block account creation entirely
   * (CODESTYLE.md §8.3, SPECS.md §14.4 graceful degradation).
   */
  async function assertPasswordNotPwned(password: string): Promise<void> {
    let pwned: boolean
    try {
      pwned = await checkPasswordPwned(password)
    } catch (error) {
      logger.warn({ error }, 'HIBP password check failed, proceeding without it')
      return
    }

    if (pwned) {
      throw new ValidationError('this password has appeared in a known data breach', {
        field: 'password',
      })
    }
  }

  async function issueEmailVerificationToken(userId: bigint, email: string): Promise<void> {
    const rawToken = generateOpaqueToken()
    await repository.insertEmailVerificationToken({
      tokenHash: sha256Hex(rawToken),
      userId,
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000),
    })
    await mailer.sendVerificationEmail(email, rawToken)
  }

  async function verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = sha256Hex(rawToken)
    const record = await repository.findEmailVerificationToken(tokenHash)

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnprocessableError('verification token is invalid or expired')
    }

    await repository.markEmailVerified(record.userId, tokenHash)
  }

  /** SPECS.md §11.3 enumeration resistance: same outcome whether or not the email is registered — only a real account actually gets an email. */
  async function forgotPassword(email: string): Promise<void> {
    const user = await repository.findUserByEmail(email)
    if (!user) return

    const rawToken = generateOpaqueToken()
    await repository.insertPasswordResetToken({
      tokenHash: sha256Hex(rawToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000),
    })
    await mailer.sendPasswordResetEmail(email, rawToken)
  }

  async function resetPassword(
    rawToken: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    const tokenHash = sha256Hex(rawToken)
    const record = await repository.findPasswordResetToken(tokenHash)
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnprocessableError('reset token is invalid or expired')
    }
    const user = await repository.findUserById(record.userId)
    if (!user) {
      throw new UnprocessableError('reset token is invalid or expired')
    }

    await assertPasswordNotPwned(newPassword)
    const passwordHash = await hashPassword(newPassword)
    // Revokes every session too (auth.repository.ts) — a forgot-password
    // flow has no session worth preserving, unlike changePassword below.
    await repository.resetPasswordWithToken(record.userId, tokenHash, passwordHash)
    await mailer.sendSecurityAlertEmail(user.email, 'password_changed', meta)
  }

  async function changePassword(
    userId: bigint,
    currentSessionId: bigint,
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta,
  ): Promise<void> {
    const user = await repository.findUserById(userId)
    if (!user?.passwordHash) {
      throw new UnauthenticatedError('current password is incorrect')
    }
    const isCurrentValid = await verifyPassword(user.passwordHash, input.currentPassword)
    if (!isCurrentValid) {
      throw new UnauthenticatedError('current password is incorrect')
    }

    await assertPasswordNotPwned(input.newPassword)
    const passwordHash = await hashPassword(input.newPassword)
    await repository.updatePasswordHash(userId, passwordHash)
    // Unlike resetPassword, the session that just proved it knows the
    // current password is worth keeping alive — only the others get logged out.
    await repository.revokeAllSessionsForUserExcept(userId, currentSessionId)
    await mailer.sendSecurityAlertEmail(user.email, 'password_changed', meta)
  }

  async function login(input: LoginInput, meta: RequestMeta): Promise<TokenPair> {
    const user = await repository.findUserByEmail(input.email)

    if (!user?.passwordHash) {
      await verifyPassword(await dummyPasswordHashPromise, input.password)
      throw new UnauthenticatedError('invalid email or password')
    }

    const passwordValid = await verifyPassword(user.passwordHash, input.password)
    if (!passwordValid) {
      throw new UnauthenticatedError('invalid email or password')
    }

    if (needsRehash(user.passwordHash)) {
      await repository.updatePasswordHash(user.id, await hashPassword(input.password))
    }

    const tokens = await issueTokenPair(user.id, meta)
    // SPECS.md §13.2: a security email, not a notification — never gated by
    // a preference, since there's no per-type/channel check to gate against
    // here in the first place (no self-follow of that pattern to break).
    await mailer.sendSecurityAlertEmail(user.email, 'new_login', meta)
    return tokens
  }

  async function issueTokenPair(userId: bigint, meta: RequestMeta): Promise<TokenPair> {
    const sessionId = generateId()
    const { row, rawToken } = buildRefreshTokenRow(userId, sessionId, meta)
    await repository.insertRefreshToken(row)
    return toTokenPair(userId, sessionId, rawToken)
  }

  function buildRefreshTokenRow(userId: bigint, sessionId: bigint, meta: RequestMeta) {
    const rawToken = generateOpaqueToken()
    return {
      rawToken,
      row: {
        id: generateId(),
        userId,
        sessionId,
        tokenHash: sha256Hex(rawToken),
        expiresAt: new Date(Date.now() + refreshTokenTtlDays * 24 * 60 * 60 * 1000),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    }
  }

  async function toTokenPair(
    userId: bigint,
    sessionId: bigint,
    rawRefreshToken: string,
  ): Promise<TokenPair> {
    const accessToken = await tokenService.signAccessToken({
      sub: userId.toString(),
      sid: sessionId.toString(),
    })
    return { accessToken, expiresInSeconds: accessTtlMinutes * 60, refreshToken: rawRefreshToken }
  }

  async function refresh(rawRefreshToken: string, meta: RequestMeta): Promise<TokenPair> {
    const tokenHash = sha256Hex(rawRefreshToken)
    const record = await repository.findRefreshTokenByHash(tokenHash)

    if (!record) {
      throw new UnauthenticatedError('invalid refresh token')
    }

    if (record.revokedAt) {
      // The token was already rotated (or explicitly revoked) — this is reuse
      // of a stale token, a strong signal of theft. Kill the whole family.
      // SPECS.md §11.1.
      await repository.revokeSession(record.sessionId)
      throw new UnauthenticatedError('refresh token reuse detected, session revoked', {
        sessionId: record.sessionId.toString(),
      })
    }

    if (record.expiresAt < new Date()) {
      throw new UnauthenticatedError('refresh token expired')
    }

    const { row, rawToken } = buildRefreshTokenRow(record.userId, record.sessionId, meta)
    await repository.rotateRefreshToken(tokenHash, row)

    return toTokenPair(record.userId, record.sessionId, rawToken)
  }

  async function logout(rawRefreshToken: string): Promise<void> {
    await repository.revokeToken(sha256Hex(rawRefreshToken))
  }

  async function logoutAll(userId: bigint): Promise<void> {
    await repository.revokeAllSessionsForUser(userId)
  }

  async function listSessions(userId: bigint, currentSessionId: bigint) {
    const rows = await repository.listActiveSessions(userId)
    return rows.map((row) => ({
      id: row.sessionId.toString(),
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt.toISOString(),
      isCurrent: row.sessionId === currentSessionId,
    }))
  }

  return {
    register,
    verifyEmail,
    forgotPassword,
    resetPassword,
    changePassword,
    login,
    refresh,
    logout,
    logoutAll,
    listSessions,
  }
}
