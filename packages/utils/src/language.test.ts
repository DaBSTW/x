import { describe, expect, it } from 'vitest'
import { detectLanguage } from './language.js'

describe('detectLanguage', () => {
  it('detects Spanish', () => {
    expect(detectLanguage('El rápido zorro marrón salta sobre el perro perezoso')).toBe('es')
  })

  it('detects English', () => {
    expect(detectLanguage('The quick brown fox jumps over the lazy dog')).toBe('en')
  })

  it('detects Portuguese', () => {
    expect(detectLanguage('A rápida raposa marrom salta sobre o cão preguiçoso')).toBe('pt')
  })

  it('detects French', () => {
    expect(detectLanguage('Le rapide renard brun saute par-dessus le chien paresseux')).toBe('fr')
  })

  it('returns null for text too short to classify reliably', () => {
    expect(detectLanguage('ok')).toBeNull()
    expect(detectLanguage('')).toBeNull()
  })

  it('returns null for text that is only emoji or punctuation', () => {
    expect(detectLanguage('🎉🎉🎉🎉🎉🎉')).toBeNull()
  })

  it('never throws, whatever the input', () => {
    expect(() => detectLanguage('a'.repeat(5000))).not.toThrow()
    expect(() => detectLanguage('123456789 !@#$%^&*()')).not.toThrow()
  })
})
