import { describe, expect, it } from 'vitest'
import { parseSearchQuery } from './query-operators.js'

describe('parseSearchQuery', () => {
  it('splits plain words into terms', () => {
    expect(parseSearchQuery('hola mundo').terms).toEqual(['hola', 'mundo'])
  })

  it('keeps a quoted phrase as one whole string, word order intact', () => {
    const parsed = parseSearchQuery('"hola mundo cruel"')
    expect(parsed.phrases).toEqual(['hola mundo cruel'])
    expect(parsed.terms).toEqual([])
  })

  it('mixes free terms and a phrase in the same query', () => {
    const parsed = parseSearchQuery('gato "perro grande" ratón')
    expect(parsed.terms).toEqual(['gato', 'ratón'])
    expect(parsed.phrases).toEqual(['perro grande'])
  })

  it('extracts hashtags without the # and lowercased', () => {
    expect(parseSearchQuery('#Mundial2026 #Fútbol').hashtags).toEqual(['mundial2026', 'fútbol'])
  })

  it('extracts mentions without the @ and lowercased', () => {
    expect(parseSearchQuery('@AnaCapital').mentions).toEqual(['anacapital'])
  })

  it('parses from:/to: operators, lowercased', () => {
    const parsed = parseSearchQuery('from:AnaCapital to:Otro')
    expect(parsed.from).toBe('anacapital')
    expect(parsed.to).toBe('otro')
  })

  it('parses filter:media and filter:links', () => {
    expect(parseSearchQuery('filter:media').filter).toBe('media')
    expect(parseSearchQuery('filter:links').filter).toBe('links')
  })

  it('ignores an unrecognized filter: value — falls through to a plain excluded-nothing term', () => {
    const parsed = parseSearchQuery('filter:bogus')
    expect(parsed.filter).toBeNull()
    expect(parsed.terms).toEqual(['filter:bogus'])
  })

  it('parses min_faves:N as a number', () => {
    expect(parseSearchQuery('min_faves:50').minFaves).toBe(50)
  })

  it('parses since:/until: as ISO date strings', () => {
    const parsed = parseSearchQuery('since:2026-01-01 until:2026-12-31')
    expect(parsed.since).toBe('2026-01-01')
    expect(parsed.until).toBe('2026-12-31')
  })

  it('parses lang:', () => {
    expect(parseSearchQuery('lang:es').lang).toBe('es')
  })

  it('excludes a plain word with a leading -', () => {
    const parsed = parseSearchQuery('gato -perro')
    expect(parsed.terms).toEqual(['gato'])
    expect(parsed.excludedTerms).toEqual(['perro'])
  })

  it('excludes a hashtag/mention/phrase with a leading -, bucketed the same as any other excluded term', () => {
    const parsed = parseSearchQuery('-#spam -@bot -"frase mala"')
    expect(parsed.hashtags).toEqual([])
    expect(parsed.mentions).toEqual([])
    expect(parsed.phrases).toEqual([])
    expect(parsed.excludedTerms).toEqual(['spam', 'bot', 'frase mala'])
  })

  it('does not treat a negated structured operator as that operator — "-from:ana" excludes the literal token instead', () => {
    const parsed = parseSearchQuery('-from:ana')
    expect(parsed.from).toBeNull()
    expect(parsed.excludedTerms).toEqual(['from:ana'])
  })

  it('combines every operator kind in one realistic query', () => {
    const parsed = parseSearchQuery(
      'mundial "copa del mundo" #Qatar2022 @fifa from:ana -spam filter:media min_faves:100 since:2026-01-01 until:2026-06-01 lang:es',
    )
    expect(parsed).toEqual({
      terms: ['mundial'],
      phrases: ['copa del mundo'],
      hashtags: ['qatar2022'],
      mentions: ['fifa'],
      excludedTerms: ['spam'],
      from: 'ana',
      to: null,
      filter: 'media',
      minFaves: 100,
      since: '2026-01-01',
      until: '2026-06-01',
      lang: 'es',
    })
  })

  it('returns an all-empty/null structure for an empty or whitespace-only query', () => {
    const parsed = parseSearchQuery('   ')
    expect(parsed.terms).toEqual([])
    expect(parsed.phrases).toEqual([])
    expect(parsed.from).toBeNull()
  })

  it('drops an empty quoted phrase ("") instead of pushing a blank string', () => {
    expect(parseSearchQuery('gato ""').phrases).toEqual([])
  })
})
