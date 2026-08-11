// Shared between apps/api (timeline reads, social-graph writes) and
// apps/workers (fan-out) — SPECS.md §6.1.

/** Accounts at or above this many followers skip write fan-out entirely; their posts are merged at read time instead. */
export const CELEBRITY_FOLLOWER_THRESHOLD = 10_000

/** Entries kept per precomputed timeline ZSET. */
export const TIMELINE_RETENTION_SIZE = 800

/** Idle timelines expire after this long — SPECS.md §6.1. */
export const TIMELINE_TTL_SECONDS = 7 * 24 * 60 * 60

/** Followers processed per Redis pipeline during fan-out. */
export const FANOUT_BATCH_SIZE = 1_000

export function timelineKey(userId: string | bigint): string {
  return `timeline:${userId}`
}
