import { parseEntities } from '@x/utils'
import { describe, expect, it } from 'vitest'
import { classifyContent } from './content-classifier.js'

describe('classifyContent', () => {
  it('scores ordinary text low on both dimensions', () => {
    const text = 'Hoy hace un día precioso para pasear por el parque.'
    const { toxicity, spam } = classifyContent(text, parseEntities(text))
    expect(toxicity).toBeLessThan(0.3)
    expect(spam).toBeLessThan(0.3)
  })

  it('scores shouting, exclamation-heavy, elongated text high on toxicity (ROADMAP.md 3.3d)', () => {
    const text = 'TE ODIO!!!! ERES UN ASCO DE PERSONAAAAA!!!!'
    const { toxicity } = classifyContent(text, parseEntities(text))
    expect(toxicity).toBeGreaterThan(0.7)
  })

  it('scores a link-heavy post with spam trigger phrases high on spam (ROADMAP.md 3.3d)', () => {
    const text = 'GANA DINERO ahora, haz clic aquí: http://a.example.com y http://b.example.com'
    const { spam } = classifyContent(text, parseEntities(text))
    expect(spam).toBeGreaterThan(0.7)
  })

  it('never lets either score exceed 1', () => {
    const text = `${'ODIO MUERTE A TE VOY A MATAR ASCO DE '.repeat(10)}!!!!!!!!!!`
    const { toxicity } = classifyContent(text, parseEntities(text))
    expect(toxicity).toBeLessThanOrEqual(1)
  })

  it('returns 0/0 for empty text', () => {
    expect(classifyContent('', [])).toEqual({ toxicity: 0, spam: 0 })
  })

  it('a single ordinary URL does not on its own push spam past the review threshold', () => {
    const text = 'mira este artículo interesante: http://example.com/articulo'
    const { spam } = classifyContent(text, parseEntities(text))
    expect(spam).toBeLessThan(0.7)
  })
})
