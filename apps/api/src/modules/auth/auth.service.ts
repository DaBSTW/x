import {
  ConflictError,
  NotFoundError,
  UnauthenticatedError,
  UnprocessableError,
  ValidationError,
  generateId,
  generateOpaqueToken,
  generateRecoveryCode,
  generateTotpSecret,
  hashPassword,
  isPasswordPwned,
  needsRehash,
  sha256Hex,
  totpKeyUri,
  verifyPassword,
  verifyTotp,
} from '@x/utils'
import type { Redis } from 'ioredis'
import QRCode from 'qrcode'
import type { Mailer, MailerLogger } from '../../lib/mailer.js'
import {
  assertLoginNotBackedOff,
  clearLoginFailures,
  recordLoginFailure,
} from '../../lib/rate-limit.js'
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

// POST /auth/login (ROADMAP.md 2.6): 'authenticated' is a normal login,
// unchanged from before 2FA existed; 'requires_two_factor' is as far as a
// correct password gets on an account with it on — see loginResponseSchema
// in @x/contracts for why this is a tagged union rather than an optional field.
export type LoginResult =
  | ({ status: 'authenticated' } & TokenPair)
  | { status: 'requires_two_factor'; challengeToken: string }

export type CreateAuthServiceOptions = {
  repository: AuthRepository
  tokenService: TokenService
  mailer: Mailer
  logger: MailerLogger
  redis: Redis
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

// Long enough to type in a 6-digit code from an authenticator app, short
// enough that a challengeToken left in browser history/logs is worthless
// shortly after (it's also single-use either way).
const TWO_FACTOR_CHALLENGE_TTL_MINUTES = 5
const RECOVERY_CODE_COUNT = 10

export type AuthService = ReturnType<typeof createAuthService>

export function createAuthService(options: CreateAuthServiceOptions) {
  const {
    repository,
    tokenService,
    mailer,
    logger,
    redis,
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

  async function login(input: LoginInput, meta: RequestMeta): Promise<LoginResult> {
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

    // A correct password on a 2FA account doesn't get a session yet — a
    // real one only comes out of loginWithTwoFactor below, once the code
    // checks out too.
    if (await repository.isTwoFactorEnabled(user.id)) {
      return {
        status: 'requires_two_factor',
        challengeToken: await issueTwoFactorChallenge(user.id),
      }
    }

    const tokens = await issueTokenPair(user.id, meta)
    // SPECS.md §13.2: a security email, not a notification — never gated by
    // a preference, since there's no per-type/channel check to gate against
    // here in the first place (no self-follow of that pattern to break).
    await mailer.sendSecurityAlertEmail(user.email, 'new_login', meta)
    return { status: 'authenticated', ...tokens }
  }

  async function issueTwoFactorChallenge(userId: bigint): Promise<string> {
    const rawToken = generateOpaqueToken()
    await repository.insertTwoFactorChallenge({
      tokenHash: sha256Hex(rawToken),
      userId,
      expiresAt: new Date(Date.now() + TWO_FACTOR_CHALLENGE_TTL_MINUTES * 60 * 1000),
    })
    return rawToken
  }

  /**
   * POST /auth/2fa/login (ROADMAP.md 2.6): the second half of signing in to
   * a 2FA-protected account — `code` may be a live TOTP or one of the
   * recovery codes issued by verifyTwoFactor. Backed off per-account like a
   * password guess (SPECS.md §11.3): a stolen password alone shouldn't let
   * an attacker brute-force 6 digits at will just because they cleared the
   * first hurdle.
   */
  async function loginWithTwoFactor(
    rawChallengeToken: string,
    code: string,
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const challengeTokenHash = sha256Hex(rawChallengeToken)
    const challenge = await repository.findTwoFactorChallenge(challengeTokenHash)
    if (!challenge || challenge.usedAt || challenge.expiresAt < new Date()) {
      throw new UnauthenticatedError('invalid or expired two-factor challenge')
    }

    const accountKey = `2fa:${challenge.userId}`
    await assertLoginNotBackedOff(redis, accountKey)

    const matched = await verifyTwoFactorCode(challenge.userId, code)
    if (!matched) {
      await recordLoginFailure(redis, accountKey)
      throw new UnauthenticatedError('invalid verification code')
    }
    await clearLoginFailures(redis, accountKey)
    await repository.markTwoFactorChallengeUsed(challengeTokenHash)

    const user = await repository.findUserById(challenge.userId)
    const tokens = await issueTokenPair(challenge.userId, meta)
    if (user) {
      await mailer.sendSecurityAlertEmail(user.email, 'new_login', meta)
    }
    return tokens
  }

  /** A live TOTP code first (cheap, in-memory), a recovery code second (a DB round trip) — either one, once, proves the same thing. */
  async function verifyTwoFactorCode(userId: bigint, code: string): Promise<boolean> {
    const secretRow = await repository.findConfirmedTwoFactorSecret(userId)
    if (!secretRow) return false

    // A recovery code is never 6 digits (it's two 10-char hex groups joined
    // by a hyphen) — skip straight to that check instead of handing an
    // obviously-wrong shape to verifyTotp, whose underlying library throws
    // on a token that isn't exactly 6 digits rather than just failing it.
    if (/^\d{6}$/.test(code)) {
      const totpResult = await verifyTotp(
        secretRow.secret,
        code,
        secretRow.lastUsedTimeStep ?? undefined,
      )
      if (totpResult.valid) {
        await repository.markTotpTimeStepUsed(userId, totpResult.timeStep)
        return true
      }
    }

    return repository.consumeRecoveryCode(userId, sha256Hex(code))
  }

  /** POST /auth/2fa/setup (ROADMAP.md 2.6): a fresh secret awaiting confirmation via verifyTwoFactor below. */
  async function setupTwoFactor(
    userId: bigint,
  ): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const user = await repository.findUserById(userId)
    if (!user) throw new NotFoundError('user', userId.toString())

    const secret = generateTotpSecret()
    await repository.upsertTwoFactorSecret(userId, secret)
    const otpauthUrl = totpKeyUri(user.username, secret)
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl)
    return { secret, otpauthUrl, qrCodeDataUrl }
  }

  /** POST /auth/2fa/verify: proves the account holder actually added the pending secret to an authenticator app before it starts gating login. */
  async function verifyTwoFactor(
    userId: bigint,
    code: string,
    meta: RequestMeta,
  ): Promise<string[]> {
    const pending = await repository.findTwoFactorSecret(userId)
    if (!pending) {
      throw new UnprocessableError('no two-factor setup in progress')
    }

    const result = await verifyTotp(pending.secret, code)
    if (!result.valid) {
      throw new UnauthenticatedError('invalid verification code')
    }

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode)
    await repository.confirmTwoFactor(userId, recoveryCodes.map(sha256Hex))

    const user = await repository.findUserById(userId)
    if (user) {
      await mailer.sendSecurityAlertEmail(user.email, 'two_factor_enabled', meta)
    }
    return recoveryCodes
  }

  async function getTwoFactorStatus(userId: bigint): Promise<boolean> {
    return repository.isTwoFactorEnabled(userId)
  }

  async function disableTwoFactor(userId: bigint, currentPassword: string): Promise<void> {
    const user = await repository.findUserById(userId)
    if (!user?.passwordHash) {
      throw new UnauthenticatedError('current password is incorrect')
    }
    const isCurrentValid = await verifyPassword(user.passwordHash, currentPassword)
    if (!isCurrentValid) {
      throw new UnauthenticatedError('current password is incorrect')
    }

    await repository.deleteTwoFactor(userId)
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

  /** ROADMAP.md 2.6: revoke one session among the caller's own — "sign out that one stolen/old laptop" without logging every device out (logoutAll) or needing that device's own refresh token (logout). */
  async function revokeSession(userId: bigint, sessionId: bigint): Promise<void> {
    const revoked = await repository.revokeSessionForUser(userId, sessionId)
    if (!revoked) throw new NotFoundError('session', sessionId.toString())
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
    loginWithTwoFactor,
    setupTwoFactor,
    verifyTwoFactor,
    getTwoFactorStatus,
    disableTwoFactor,
    refresh,
    logout,
    logoutAll,
    listSessions,
    revokeSession,
  }
}
