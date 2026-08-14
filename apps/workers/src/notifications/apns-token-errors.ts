import type { ResponseFailure } from '@parse/node-apn'

/**
 * Apple's documented APNs response reasons that mean a device token will
 * never succeed again — the APNs equivalent of web-push's 404/410
 * (push-sender.ts's own `expired` check). `Unregistered` is the definitive
 * signal (HTTP 410 — the device is no longer registered for this topic,
 * Apple's own direct equivalent of web-push's 410); `BadDeviceToken`
 * (malformed, or issued for a different app/environment than this
 * provider is configured for) will also never succeed, so it's treated
 * the same way rather than retried forever.
 */
const DEAD_TOKEN_REASONS = new Set(['Unregistered', 'BadDeviceToken'])

export function isApnsTokenDead(failure: Pick<ResponseFailure, 'response'>): boolean {
  return failure.response !== undefined && DEAD_TOKEN_REASONS.has(failure.response.reason)
}
