import type { ParsedEntity } from '@x/utils'

export type ClassificationScores = {
  toxicity: number
  spam: number
}

/**
 * ROADMAP.md 3.3 / SPECS.md §12.1's automatic layer — "clasificadores de
 * toxicidad, spam y NSFW sobre texto e imagen". Text only: NSFW image
 * classification has no honest simple substitute the way the URL check in
 * posts.service.ts does (Google's own published *testing* domains) or
 * 2.7's CSAM scanning does (perceptual hashing against a *known* image
 * set) — general NSFW classification means judging *novel* images by
 * content, which genuinely needs a trained model this environment doesn't
 * have. Documented here as a real, deliberate gap rather than faked with
 * a classifier that would just be randomness with extra steps.
 *
 * Toxicity/spam below are real, testable heuristics, not a trained
 * model — the same class of honest simplification as 2.7's PhotoDNA/
 * SHA-256 stood in for a real CSAM vendor and this checkpoint's own
 * malicious-URL check stands in for a real Safe Browsing API. Each
 * signal is a plain, explainable rule (caps ratio, punctuation density,
 * a small illustrative keyword set) rather than anything resembling a
 * real toxicity/spam model's actual decision boundary — good enough to
 * exercise SPECS.md §12.1's threshold routing end-to-end (>0.95 auto-
 * action, 0.70–0.95 human queue, <0.70 log-only) with real, deterministic
 * scores, not good enough to actually moderate a production platform.
 */
export function classifyContent(text: string, entities: ParsedEntity[]): ClassificationScores {
  return { toxicity: classifyToxicity(text), spam: classifySpam(text, entities) }
}

// Small and illustrative on purpose, not a real moderation wordlist (same
// reasoning env.ts's BLOCKED_TERMS ships empty by default) — just enough
// for the heuristic below to have a real, testable keyword signal.
const AGGRESSIVE_MARKERS = ['odio', 'muerte a', 'te voy a matar', 'asco de']
const ELONGATED_PATTERN = /(.)\1{3,}/g // "aaaaaa", "!!!!!" — 4+ repeats of any one character

function classifyToxicity(text: string): number {
  if (text.length === 0) return 0

  const words = text.split(/\s+/).filter((word) => word.length >= 3)
  const capsWords = words.filter((word) => word === word.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(word))
  const capsRatio = words.length > 0 ? capsWords.length / words.length : 0

  const exclamationDensity = (text.match(/!/g)?.length ?? 0) / text.length
  const elongationCount = text.match(ELONGATED_PATTERN)?.length ?? 0
  const lowerText = text.toLowerCase()
  const markerHits = AGGRESSIVE_MARKERS.filter((marker) => lowerText.includes(marker)).length

  const score =
    capsRatio * 0.3 +
    Math.min(exclamationDensity * 10, 0.25) +
    Math.min(elongationCount * 0.15, 0.3) +
    Math.min(markerHits * 0.4, 0.8)

  return Math.min(score, 1)
}

const SPAM_PHRASES = ['gana dinero', 'haz clic aquí', 'oferta limitada', 'gratis ahora']

function classifySpam(text: string, entities: ParsedEntity[]): number {
  if (text.length === 0) return 0

  const urlCount = entities.filter((entity) => entity.kind === 'url').length
  // More than one URL in a short post is a real spam signal in practice;
  // scaled, not a hard cutoff (MAX_MENTIONS/MAX_HASHTAGS already hard-cap
  // those two separately, at the preventive layer, not here).
  const urlDensity = urlCount / Math.max(text.length / 40, 1)

  const lowerText = text.toLowerCase()
  const phraseHits = SPAM_PHRASES.filter((phrase) => lowerText.includes(phrase)).length

  const words = text.split(/\s+/).filter((word) => word.length >= 3)
  const capsWords = words.filter((word) => word === word.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(word))
  const capsRatio = words.length > 0 ? capsWords.length / words.length : 0

  const score = Math.min(urlDensity * 0.5, 0.6) + Math.min(phraseHits * 0.4, 0.8) + capsRatio * 0.15

  return Math.min(score, 1)
}
