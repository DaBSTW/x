import { z } from 'zod'

// Snowflake IDs are serialized as strings on the wire — a 64-bit bigint loses
// precision once JSON.parse coerces it to a JS `number` (SPECS.md §5.1).
export const snowflakeIdSchema = z.string().regex(/^\d+$/, 'must be a numeric id')

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
})
export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export const paginationMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  prevCursor: z.string().nullable(),
  hasMore: z.boolean(),
})
export type PaginationMeta = z.infer<typeof paginationMetaSchema>

export function paginatedResponseSchema<Item extends z.ZodTypeAny>(itemSchema: Item) {
  return z.object({
    data: z.array(itemSchema),
    meta: paginationMetaSchema,
  })
}

export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'BLOCKED_BY_USER',
  'NOT_FOUND',
  'CONFLICT',
  'UNPROCESSABLE',
  'RATE_LIMIT_EXCEEDED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
])
export type ErrorCode = z.infer<typeof errorCodeSchema>

// Shape of every error response — SPECS.md §5.3.
export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    requestId: z.string(),
  }),
})
export type ErrorResponse = z.infer<typeof errorResponseSchema>
