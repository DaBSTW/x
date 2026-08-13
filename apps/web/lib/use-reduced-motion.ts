import { useEffect, useState } from 'react'

/**
 * ROADMAP.md 2.7's player bullet: never autoplay motion for someone whose
 * OS says they don't want it. Starts `false` (there's no `window` during
 * SSR/the first render) and syncs for real once mounted — same "defer
 * browser-only reads to a client effect" pattern MediaGrid's own
 * blurhash-canvas rendering already uses, extended here to a live
 * subscription so a mid-session OS-level change (rare, but real) is
 * honored without needing a reload.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(query.matches)
    const listener = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  return prefersReducedMotion
}
