import type { Database } from '@x/db'
import { posts, refreshTokens, reports } from '@x/db'
import { generateId } from '@x/utils'
import { and, desc, gte, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { CandidatePost, CoordinationReason } from './coordination-detector.js'

export type CoordinationRepository = ReturnType<typeof createCoordinationRepository>

export function createCoordinationRepository(db: Database) {
  return {
    /**
     * coordination-sweep.worker.ts's own candidate window for one tick —
     * visible, non-empty-text posts created since `since`. Bounded by
     * design (SPECS.md gives no scale target for this feature): a real
     * hyperscale deployment would replace the pairwise comparison this
     * feeds (coordination-detector.ts) with LSH banding instead of simply
     * widening this window — the same honest scaling caveat as this
     * checkpoint's other heuristics (../lib/content-classifier.ts, over in
     * apps/api).
     */
    async findRecentPosts(since: Date): Promise<CandidatePost[]> {
      const rows = await db
        .select({
          id: posts.id,
          authorId: posts.authorId,
          text: posts.text,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .where(
          and(
            gte(posts.createdAt, since),
            isNull(posts.deletedAt),
            isNull(posts.moderatorHiddenAt),
            isNotNull(posts.text),
          ),
        )
      // isNotNull(posts.text) above already guarantees this at the SQL
      // level — the filter+narrow here is just so CandidatePost's `text` can
      // stay a plain `string`, not `string | null`, for every caller.
      return rows.filter((row): row is CandidatePost => row.text !== null)
    },

    /**
     * SPECS.md §12.3's "huella de red" — each author's most-recently-used
     * session IP, when any is on record. `refresh_tokens` (SPECS.md's own
     * retention policy calls these "IPs de sesión") is the only place this
     * app ever captures one; an author who has never logged in with an IP
     * on record (impossible in practice — registration itself creates a
     * session — but a defensive case) simply doesn't appear in the
     * returned map, and coordination-detector.ts already treats a missing
     * entry as "unknown", not "no match".
     */
    async findLatestIpAddresses(authorIds: bigint[]): Promise<Map<bigint, string>> {
      if (authorIds.length === 0) return new Map()
      const rows = await db
        .selectDistinctOn([refreshTokens.userId], {
          userId: refreshTokens.userId,
          ipAddress: refreshTokens.ipAddress,
        })
        .from(refreshTokens)
        .where(and(inArray(refreshTokens.userId, authorIds), isNotNull(refreshTokens.ipAddress)))
        .orderBy(refreshTokens.userId, desc(refreshTokens.createdAt))

      const result = new Map<bigint, string>()
      for (const row of rows) {
        if (row.ipAddress) result.set(row.userId, row.ipAddress)
      }
      return result
    },

    /**
     * Flags one post from a detected cluster for human review — reuses the
     * same `reports` queue ROADMAP.md 3.3d's automatic classifiers already
     * queue into (reporterId `null` = system-generated), rather than a
     * parallel structure. coordination-sweep.worker.ts's own Redis guard is
     * what keeps this idempotent across sweep ticks — this call always
     * inserts.
     */
    async flagPostForReview(
      postId: bigint,
      authorCount: number,
      reason: CoordinationReason,
      priority: number,
    ): Promise<void> {
      await db.insert(reports).values({
        id: generateId(),
        reporterId: null,
        targetType: 'post',
        targetId: postId,
        category: 'coordinated_activity',
        reason: `coordinated cluster of ${authorCount} accounts (signal: ${reason})`,
        priority,
      })
    },
  }
}
