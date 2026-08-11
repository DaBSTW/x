import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  errorResponseSchema,
  paginatedResponseSchema,
  paginationQuerySchema,
  snowflakeIdSchema,
} from './common.js'

describe('snowflakeIdSchema', () => {
  it('accepts a numeric string', () => {
    expect(snowflakeIdSchema.safeParse('1823456789012345678').success).toBe(true)
  })

  it('rejects a value that is not purely numeric', () => {
    expect(snowflakeIdSchema.safeParse('182345abc').success).toBe(false)
  })
})

describe('paginationQuerySchema', () => {
  it('defaults limit to 20 when omitted', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20, cursor: undefined })
  })

  it('rejects a limit above 100', () => {
    expect(paginationQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
  })

  it('coerces a string limit from query params', () => {
    expect(paginationQuerySchema.parse({ limit: '50' }).limit).toBe(50)
  })
})

describe('paginatedResponseSchema', () => {
  it('wraps an item schema with pagination metadata', () => {
    const schema = paginatedResponseSchema(z.object({ id: z.string() }))

    const result = schema.safeParse({
      data: [{ id: '1' }],
      meta: { nextCursor: 'abc', prevCursor: null, hasMore: true },
    })

    expect(result.success).toBe(true)
  })
})

describe('errorResponseSchema', () => {
  it('accepts the documented error shape', () => {
    const result = errorResponseSchema.safeParse({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Has superado el límite de publicaciones.',
        details: { retryAfter: 300 },
        requestId: '01J8XQ2K9M3NPT4V6WZ',
      },
    })

    expect(result.success).toBe(true)
  })

  it('rejects an unknown error code', () => {
    const result = errorResponseSchema.safeParse({
      error: { code: 'NOT_A_REAL_CODE', message: 'x', requestId: 'x' },
    })

    expect(result.success).toBe(false)
  })
})
