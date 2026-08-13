import { z } from 'zod'
import { paginationMetaSchema } from './common.js'
import { postSchema } from './post.js'
import { followListItemSchema } from './social-graph.js'

// SPECS.md §5.4: `GET /search?q=&type=top|latest|people|media`.
export const searchTypeSchema = z.enum(['top', 'latest', 'people', 'media'])
export type SearchType = z.infer<typeof searchTypeSchema>

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(300),
  type: searchTypeSchema.default('top'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // Opaque — encodes OpenSearch's own `search_after` sort values, not a
  // Snowflake id like the rest of this app's cursors (common.ts's
  // encodeCursor/decodeCursor): relevance-ranked results have no id to page
  // by. Still never OFFSET (CODESTYLE.md §13) — search.service.ts's own
  // cursor.ts applies the same "opaque token, never a raw position" rule,
  // just generalized to whatever OpenSearch actually sorted by.
  cursor: z.string().optional(),
})
export type SearchQuery = z.infer<typeof searchQuerySchema>

// `top`/`latest`/`media` return posts; `people` returns profile cards — the
// caller already knows which shape to expect from the `type` it requested,
// so the response doesn't need its own discriminant tag.
export const searchResponseSchema = z.object({
  data: z.union([z.array(postSchema), z.array(followListItemSchema)]),
  meta: paginationMetaSchema,
})
export type SearchResponse = z.infer<typeof searchResponseSchema>

export const typeaheadQuerySchema = z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(10),
})
export type TypeaheadQuery = z.infer<typeof typeaheadQuerySchema>

export const typeaheadResponseSchema = z.object({
  data: z.object({
    users: z.array(followListItemSchema),
    hashtags: z.array(z.string()),
  }),
})
export type TypeaheadResponse = z.infer<typeof typeaheadResponseSchema>
