import { describe, expect, it } from 'vitest'
import { hammingDistance, simhash } from './simhash.js'

describe('simhash', () => {
  it('is deterministic — the same text always produces the same fingerprint', () => {
    const text = 'compra ahora mismo, oferta increíble por tiempo limitado!!'
    expect(simhash(text)).toBe(simhash(text))
  })

  it('is case-insensitive and whitespace-insensitive', () => {
    const a = simhash('Compra Ahora Mismo')
    const b = simhash('compra   ahora    mismo')
    expect(hammingDistance(a, b)).toBe(0)
  })

  it('gives near-identical fingerprints to near-identical text (an emoji and a word swapped)', () => {
    const original = simhash('compra ahora mismo, oferta increíble por tiempo limitado')
    const nearDuplicate = simhash('compra ahora mismo 🔥 oferta increíble por tiempo reducido')
    // coordination-detector.ts's own threshold is the real acceptance bar —
    // this only needs "clearly close", not the exact number.
    expect(hammingDistance(original, nearDuplicate)).toBeLessThanOrEqual(10)
  })

  it('gives far-apart fingerprints to unrelated text', () => {
    const a = simhash('compra ahora mismo, oferta increíble por tiempo limitado')
    const b = simhash('mi gato durmió todo el día en la ventana de la cocina')
    // Not a tight bound — SimHash's own guarantee is "roughly half the bits
    // differ for unrelated inputs", not an exact number — but it must land
    // well clear of the near-duplicate case above, which is the property
    // coordination-detector.ts's clustering actually depends on.
    expect(hammingDistance(a, b)).toBeGreaterThan(20)
  })

  it('hammingDistance is symmetric and zero for a value against itself', () => {
    const a = simhash('un texto cualquiera')
    const b = simhash('otro texto completamente distinto sobre otra cosa')
    expect(hammingDistance(a, a)).toBe(0)
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a))
  })

  it('handles empty and very short text without throwing', () => {
    expect(() => simhash('')).not.toThrow()
    expect(() => simhash('hi')).not.toThrow()
    expect(hammingDistance(simhash(''), simhash(''))).toBe(0)
  })

  it('stays within the 64-bit range', () => {
    const hash = simhash('cualquier texto de prueba')
    expect(hash).toBeGreaterThanOrEqual(0n)
    expect(hash).toBeLessThan(1n << 64n)
  })
})
