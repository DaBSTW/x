import { describe, expect, it } from 'vitest'
import { createListSchema, listSchema, updateListSchema } from './list.js'

describe('createListSchema', () => {
  it('accepts a name-only list and defaults isPrivate to false', () => {
    const result = createListSchema.parse({ name: 'Noticias' })
    expect(result).toEqual({ name: 'Noticias', isPrivate: false })
  })

  it('rejects an empty name', () => {
    expect(createListSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects a name over 25 characters', () => {
    expect(createListSchema.safeParse({ name: 'x'.repeat(26) }).success).toBe(false)
  })

  it('rejects a description over 100 characters', () => {
    const result = createListSchema.safeParse({ name: 'ok', description: 'x'.repeat(101) })
    expect(result.success).toBe(false)
  })
})

describe('updateListSchema', () => {
  it('accepts a partial patch with only one field', () => {
    expect(updateListSchema.safeParse({ isPrivate: true }).success).toBe(true)
  })

  it('accepts an empty patch', () => {
    expect(updateListSchema.safeParse({}).success).toBe(true)
  })
})

describe('listSchema', () => {
  it('accepts a full list DTO', () => {
    const result = listSchema.safeParse({
      id: '1',
      ownerId: '2',
      name: 'Noticias',
      description: null,
      isPrivate: false,
      memberCount: 0,
      createdAt: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })
})
