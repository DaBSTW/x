import { z } from 'zod'

// ROADMAP.md 2.4 / SPECS.md §10.4.
export const trendSchema = z.object({
  hashtag: z.string(),
  score: z.number(),
  postCount1h: z.number().int().nonnegative(),
  uniqueAuthors1h: z.number().int().nonnegative(),
})
export type Trend = z.infer<typeof trendSchema>

// 50 mirrors @x/utils' MAX_TRENDS_PER_SCOPE — duplicated as a literal since
// this package has no dependency on that one (same reasoning as
// MAX_POST_GRAPHEMES's 280 in post.ts): the ceiling a GET /trends caller
// can ever usefully ask for, since compute-trends.ts never retains more
// than that per scope in the first place.
export const trendsQuerySchema = z.object({
  // ISO 639-1 (packages/utils' detectLanguage output) — omitted means the
  // 'global' scope, every language combined.
  lang: z.string().min(2).max(8).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})
export type TrendsQuery = z.infer<typeof trendsQuerySchema>

export const trendsResponseSchema = z.object({
  data: z.array(trendSchema),
})
