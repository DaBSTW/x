import { z } from 'zod'
import { paginatedResponseSchema, snowflakeIdSchema } from './common.js'

// Matches lists.name/description's VARCHAR(25)/VARCHAR(100) — SPECS.md §4.2.
const listNameSchema = z.string().min(1).max(25)
const listDescriptionSchema = z.string().max(100)

export const createListSchema = z.object({
  name: listNameSchema,
  description: listDescriptionSchema.optional(),
  isPrivate: z.boolean().default(false),
})
export type CreateListInput = z.infer<typeof createListSchema>

export const updateListSchema = z.object({
  name: listNameSchema.optional(),
  description: listDescriptionSchema.optional(),
  isPrivate: z.boolean().optional(),
})
export type UpdateListInput = z.infer<typeof updateListSchema>

export const listSchema = z.object({
  id: snowflakeIdSchema,
  ownerId: snowflakeIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  isPrivate: z.boolean(),
  memberCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
})
export type List = z.infer<typeof listSchema>

export const listResponseSchema = z.object({ data: listSchema })
export const listListResponseSchema = paginatedResponseSchema(listSchema)
