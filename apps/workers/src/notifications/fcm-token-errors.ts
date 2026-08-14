/**
 * FCM error codes that mean a device token will never succeed again — the
 * FCM equivalent of web-push's 404/410 (push-sender.ts's own `expired`
 * check). Thrown as `FirebaseMessagingError.code`, always prefixed
 * `messaging/` — verified against the installed `firebase-admin@14`'s own
 * source (`MessagingClientErrorCode`/`FirebaseMessagingError`'s
 * constructor builds `code` as `` `messaging/${info.code}` ``), since that
 * exact prefix isn't part of either package's public documentation, only
 * its implementation.
 */
const DEAD_TOKEN_CODES = new Set([
  // The definitive signal — the app was uninstalled, or the token was
  // otherwise explicitly revoked.
  'messaging/registration-token-not-registered',
  // Malformed, or issued by a different Firebase project than this
  // server is configured for — retrying changes nothing either way.
  'messaging/invalid-registration-token',
])

export function isFcmTokenDead(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && DEAD_TOKEN_CODES.has(code)
}
