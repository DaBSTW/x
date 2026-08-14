/**
 * ROADMAP.md 3.3e / SPECS.md §12.3's antispam trust score — "antigüedad,
 * verificación de email/teléfono, ratio seguidores/seguidos, tasa de
 * reportes, patrones de comportamiento". Phone verification doesn't
 * factor in: this app has no phone/SMS verification feature anywhere
 * (only email, ROADMAP.md 0.4) — an honest gap, not silently ignored.
 * "Patrones de comportamiento" is folded into the report/action history
 * below rather than a separate signal — the closest thing to a behavior
 * signal this app actually has recorded anywhere.
 *
 * A real, explainable formula (five capped, weighted terms summing to at
 * most 1), not a trained model — same honest-simplification posture as
 * content-classifier.ts's toxicity/spam scores.
 */
export type TrustScoreFacts = {
  accountAgeMs: number
  emailVerified: boolean
  followersCount: number
  followingCount: number
  /** Every report ever filed against this account, regardless of outcome. */
  reportCount: number
  /** Moderation actions actually applied against this account — a stronger signal than reportCount alone (a report can be dismissed; an action already wasn't). */
  actionedCount: number
}

const ACCOUNT_AGE_TRUST_CAP_MS = 365 * 24 * 60 * 60 * 1000 // a year old counts as "established"

export function computeTrustScore(facts: TrustScoreFacts): number {
  const ageScore = Math.min(facts.accountAgeMs / ACCOUNT_AGE_TRUST_CAP_MS, 1) * 0.3
  const verificationScore = facts.emailVerified ? 0.2 : 0
  // A followers/following ratio near or above 1 is a healthy signal; a
  // new account following hundreds while followed by nobody is the
  // classic bot/spam shape. 0 following means the ratio itself is
  // meaningless yet — a neutral 0.5, not the max a "ratio of 1" would imply.
  const ratio = facts.followingCount > 0 ? facts.followersCount / facts.followingCount : 0.5
  const ratioScore = Math.min(ratio, 1) * 0.2
  // Both penalties scale with how much history there is, not just
  // whether any exists — one dismissed report shouldn't read the same as
  // five upheld actions.
  const reportPenalty = Math.min(facts.reportCount * 0.05, 0.3)
  const actionPenalty = Math.min(facts.actionedCount * 0.15, 0.6)
  const behaviorScore = Math.max(0.3 - reportPenalty - actionPenalty, 0)

  return Math.min(ageScore + verificationScore + ratioScore + behaviorScore, 1)
}

// SPECS.md §12.3 / ROADMAP.md 3.3e's new-account limits — a plain age
// check, not derived from the trust score above: SPECS.md states these as
// two fixed rules ("10 posts/día, sin enlaces las primeras 24h"), not "a
// low-trust account gets restricted," so they're kept independent —
// scoring low from a bad ratio or a report doesn't extend the window, and
// a well-behaved brand-new account doesn't escape it early either.
export const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000
export const NEW_ACCOUNT_MAX_POSTS_PER_DAY = 10

export function isNewAccount(accountAgeMs: number): boolean {
  return accountAgeMs < NEW_ACCOUNT_WINDOW_MS
}
