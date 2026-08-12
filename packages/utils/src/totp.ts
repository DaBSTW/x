import { OTP } from 'otplib'

const ISSUER = 'X'
// ±1 time step of clock drift between the server and whatever generated the
// code (phone, hardware key) — RFC 6238 expects an implementation to allow
// some slack here; 0 (the library default) would reject a real, valid code
// from a phone whose clock is a few seconds off.
const EPOCH_TOLERANCE_SECONDS = 30

const otp = new OTP({ strategy: 'totp' })

/** A fresh base32 TOTP secret for `POST /auth/2fa/setup` (ROADMAP.md 2.6). */
export function generateTotpSecret(): string {
  return otp.generateSecret()
}

/** The `otpauth://` URI a QR code encodes — `accountLabel` is what the authenticator app shows next to "X". */
export function totpKeyUri(accountLabel: string, secret: string): string {
  return otp.generateURI({ issuer: ISSUER, label: accountLabel, secret })
}

/**
 * Generates the current code for `secret` — what an authenticator app does,
 * never what this server does (it only ever verifies). Exists so tests
 * (here and in apps/api) can stand in for "the user's phone" without
 * reaching past this module into otplib directly. `epochSeconds` defaults
 * to now; a fixed value is only for exercising a specific time step, e.g.
 * verifyTotp's replay-protection tests below.
 */
export function generateTotp(secret: string, epochSeconds?: number): Promise<string> {
  return otp.generate({ secret, ...(epochSeconds !== undefined && { epoch: epochSeconds }) })
}

export type TotpVerifyResult = { valid: true; timeStep: number } | { valid: false }

/**
 * Verifies a 6-digit code against `secret`. `afterTimeStep`, when given,
 * rejects a code already consumed at or before that time step — replay
 * protection for a code an attacker captured in transit, not just a
 * bare "is this the right 6 digits right now" check.
 */
export async function verifyTotp(
  secret: string,
  token: string,
  afterTimeStep?: number,
): Promise<TotpVerifyResult> {
  const result = await otp.verify({
    secret,
    token,
    epochTolerance: EPOCH_TOLERANCE_SECONDS,
    ...(afterTimeStep !== undefined && { afterTimeStep }),
  })
  // OTP.verify()'s return type covers both TOTP and HOTP results (the class
  // supports either strategy) even though `otp` above is always constructed
  // with strategy: 'totp' — `timeStep` only exists on the TOTP variant, so
  // an `in` check narrows it where a bare `result.valid` can't.
  return result.valid && 'timeStep' in result
    ? { valid: true, timeStep: result.timeStep }
    : { valid: false }
}
