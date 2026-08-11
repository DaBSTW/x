import { describe, expect, it } from 'vitest'
import { createConversationSchema, sendMessageSchema } from './conversation.js'

describe('createConversationSchema', () => {
  it('accepts a 1:1 conversation with a single member and defaults isGroup to false', () => {
    const result = createConversationSchema.parse({ memberIds: ['1'] })
    expect(result).toEqual({ memberIds: ['1'], isGroup: false })
  })

  it('rejects an empty memberIds array', () => {
    expect(createConversationSchema.safeParse({ memberIds: [] }).success).toBe(false)
  })

  it('rejects more than 50 members', () => {
    const memberIds = Array.from({ length: 51 }, (_, i) => String(i))
    expect(createConversationSchema.safeParse({ memberIds }).success).toBe(false)
  })

  it('accepts a named group conversation', () => {
    const result = createConversationSchema.safeParse({
      memberIds: ['1', '2'],
      isGroup: true,
      name: 'Equipo',
    })
    expect(result.success).toBe(true)
  })
})

describe('sendMessageSchema', () => {
  it('rejects an empty message', () => {
    expect(sendMessageSchema.safeParse({ text: '' }).success).toBe(false)
  })

  it('rejects a message over 10000 characters', () => {
    expect(sendMessageSchema.safeParse({ text: 'x'.repeat(10001) }).success).toBe(false)
  })

  it('accepts a normal message', () => {
    expect(sendMessageSchema.safeParse({ text: 'hola' }).success).toBe(true)
  })
})
