import { describe, expect, it } from 'vitest'
import { NEW_ACCOUNT_WINDOW_MS, computeTrustScore, isNewAccount } from './trust-score.js'

const YEAR_MS = 365 * 24 * 60 * 60 * 1000

describe('computeTrustScore', () => {
  it('scores a mature, verified, well-balanced, clean-history account at (or near) the max', () => {
    const score = computeTrustScore({
      accountAgeMs: YEAR_MS * 2,
      emailVerified: true,
      followersCount: 100,
      followingCount: 100,
      reportCount: 0,
      actionedCount: 0,
    })
    expect(score).toBeCloseTo(1, 5)
  })

  it('scores a brand-new, unverified account low — no negative history yet, but no positive signal either', () => {
    const score = computeTrustScore({
      accountAgeMs: 0,
      emailVerified: false,
      followersCount: 0,
      followingCount: 0,
      reportCount: 0,
      actionedCount: 0,
    })
    // Only behaviorScore's clean-history default (0.3) and ratioScore's
    // neutral-when-no-following default (0.5 * 0.2 = 0.1) contribute —
    // 0.4 exactly, well under the 1.0 an established account reaches.
    expect(score).toBeCloseTo(0.4, 5)
  })

  it('penalizes an account with a real moderation history more than one with only dismissed reports', () => {
    const reportedOnly = computeTrustScore({
      accountAgeMs: YEAR_MS,
      emailVerified: true,
      followersCount: 50,
      followingCount: 50,
      reportCount: 3,
      actionedCount: 0,
    })
    const actionedToo = computeTrustScore({
      accountAgeMs: YEAR_MS,
      emailVerified: true,
      followersCount: 50,
      followingCount: 50,
      reportCount: 3,
      actionedCount: 3,
    })
    expect(actionedToo).toBeLessThan(reportedOnly)
  })

  it('penalizes a bot-shaped follow ratio (following hundreds, followed by nobody)', () => {
    const botShaped = computeTrustScore({
      accountAgeMs: YEAR_MS,
      emailVerified: true,
      followersCount: 2,
      followingCount: 2000,
      reportCount: 0,
      actionedCount: 0,
    })
    const balanced = computeTrustScore({
      accountAgeMs: YEAR_MS,
      emailVerified: true,
      followersCount: 200,
      followingCount: 200,
      reportCount: 0,
      actionedCount: 0,
    })
    expect(botShaped).toBeLessThan(balanced)
  })

  it('never exceeds 1, even for an implausibly perfect account', () => {
    const score = computeTrustScore({
      accountAgeMs: YEAR_MS * 50,
      emailVerified: true,
      followersCount: 1_000_000,
      followingCount: 1,
      reportCount: 0,
      actionedCount: 0,
    })
    expect(score).toBeLessThanOrEqual(1)
  })

  it('never goes below 0, even for the worst plausible history', () => {
    const score = computeTrustScore({
      accountAgeMs: 0,
      emailVerified: false,
      followersCount: 0,
      followingCount: 1000,
      reportCount: 100,
      actionedCount: 100,
    })
    expect(score).toBeGreaterThanOrEqual(0)
  })
})

describe('isNewAccount', () => {
  it('is true for an account younger than 24h, false at or past it', () => {
    expect(isNewAccount(0)).toBe(true)
    expect(isNewAccount(NEW_ACCOUNT_WINDOW_MS - 1)).toBe(true)
    expect(isNewAccount(NEW_ACCOUNT_WINDOW_MS)).toBe(false)
    expect(isNewAccount(NEW_ACCOUNT_WINDOW_MS + 1)).toBe(false)
  })
})
