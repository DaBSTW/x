import type { Database } from '@x/db'
import { trendingTopics } from '@x/db'
import { desc, eq } from 'drizzle-orm'

export type TrendRow = {
  hashtag: string
  score: number
  postCount1h: number
  uniqueAuthors1h: number
}

export type TrendsRepository = ReturnType<typeof createTrendsRepository>

export function createTrendsRepository(db: Database) {
  return {
    /**
     * The current snapshot for `scope` (apps/workers' compute-trends.ts is
     * the only writer, replacing it wholesale every 5 minutes), highest
     * score first. An unknown or not-yet-computed scope returns an empty
     * list, never a 404 — GET /trends is a query over what happens to
     * exist right now, not a resource with an identity of its own.
     */
    async listTopByScope(scope: string, limit: number): Promise<TrendRow[]> {
      return db
        .select({
          hashtag: trendingTopics.hashtag,
          score: trendingTopics.score,
          postCount1h: trendingTopics.postCount1h,
          uniqueAuthors1h: trendingTopics.uniqueAuthors1h,
        })
        .from(trendingTopics)
        .where(eq(trendingTopics.scope, scope))
        .orderBy(desc(trendingTopics.score))
        .limit(limit)
    },
  }
}
