import { describe, expect, it } from 'vitest'
import { buildPushText } from './push-text.js'

describe('buildPushText', () => {
  it('names the actor when one is known', () => {
    expect(buildPushText('follow', 'ana')).toEqual({
      title: 'X',
      body: '@ana empezó a seguirte',
    })
  })

  it('falls back to "Alguien" when the actor username is unknown', () => {
    expect(buildPushText('like', null)).toEqual({
      title: 'X',
      body: 'Alguien le dio me gusta a tu post',
    })
  })

  it('covers every notification kind', () => {
    const kinds = [
      'like',
      'repost',
      'reply',
      'quote',
      'follow',
      'mention',
      'follow_request',
      'system',
    ] as const
    for (const kind of kinds) {
      const { body } = buildPushText(kind, 'ana')
      expect(body.length).toBeGreaterThan(0)
    }
  })

  it('has no actor mention for a system notification', () => {
    expect(buildPushText('system', 'ana').body).toBe('Notificación del sistema')
  })
})
