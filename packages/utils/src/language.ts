import { franc } from 'franc-min'

// franc-min returns ISO 639-3; `posts.lang`/`users.lang` store ISO 639-1
// (SPECS.md §10.1's `lang: {type: keyword}` OpenSearch mapping and its
// `lang:es` search operator — ROADMAP.md 2.3, not built yet, but the column
// and this mapping exist for it; ROADMAP.md 2.4 "Tendencias" is the first
// real reader, via language segmentation). Only the languages this table
// lists are ever written to `posts.lang` — a 639-3 code franc-min
// recognizes but this table doesn't have falls back to `null`, same as no
// detection running at all. That makes this strictly additive over today's
// permanently-null column (nothing ever populated it before), never a
// regression: worst case is a post whose language stays unknown, exactly
// today's behavior for every post.
const ISO_639_3_TO_1: Readonly<Record<string, string>> = {
  spa: 'es',
  eng: 'en',
  por: 'pt',
  fra: 'fr',
  deu: 'de',
  ita: 'it',
  nld: 'nl',
  rus: 'ru',
  jpn: 'ja',
  cmn: 'zh',
  kor: 'ko',
  ara: 'ar',
  hin: 'hi',
  tur: 'tr',
  pol: 'pl',
  swe: 'sv',
  ces: 'cs',
  ron: 'ro',
  ell: 'el',
  heb: 'he',
  vie: 'vi',
  tha: 'th',
  ind: 'id',
  ukr: 'uk',
  dan: 'da',
  fin: 'fi',
  nob: 'no',
  nno: 'no',
  hun: 'hu',
  cat: 'ca',
}

// franc-min's default `minLength` (10) rejects most post-length text before
// even attempting a guess — a hashtag-only post like "#gato" is 5 code
// points. Lowered, not removed: reliable detection under ~3 characters
// isn't possible in any trigram-based detector, so `und` there is a correct
// answer, not a missed case.
const MIN_DETECTABLE_LENGTH = 3

/**
 * Best-effort ISO 639-1 language of `text`, or `null` when undetected or
 * outside {@link ISO_639_3_TO_1}'s coverage. Never throws — franc-min is a
 * pure statistical classifier with no I/O, and a bad guess should cost a
 * post its `lang` field, never the post itself (CODESTYLE.md §8.3).
 */
export function detectLanguage(text: string): string | null {
  const code3 = franc(text, { minLength: MIN_DETECTABLE_LENGTH })
  if (code3 === 'und') return null
  return ISO_639_3_TO_1[code3] ?? null
}
