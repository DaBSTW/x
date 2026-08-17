const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1'

// The subset of next/web-vitals' useReportWebVitals callback shape this
// file actually reads — a local type instead of importing Metric from
// next/dist/compiled/web-vitals (an internal path, even though it's what
// that hook's own .d.ts resolves to under the hood): whatever object shape
// the hook hands the callback structurally satisfies this regardless,
// without this file depending on Next's own internal module layout.
export type WebVitalsMetric = {
  name: string
  value: number
  rating: string
  navigationType: string
}

// ROADMAP.md 3.4g / SPECS.md §14's Core Web Vitals RUM. web-vitals-reporter.tsx
// calls this once per useReportWebVitals callback — one navigator.sendBeacon
// per metric, not batched: web-vitals' own metrics arrive at genuinely
// different times within one page view (TTFB/FCP early, LCP mid-load,
// CLS/INP only final once the page is hidden or navigated away from), and
// sendBeacon is specifically built to survive that last case reliably —
// batching would mean holding metrics in memory across that same unload
// event this exists to survive.
const ACCEPTED_METRICS = new Set(['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'])

/**
 * Reduces a concrete pathname ("/alice/status/123") to its route pattern
 * ("/[username]/status/[id]") using the same dynamic segment values
 * Next.js's own useParams() already resolved for this page — never sends a
 * real username, post id, or any other resource identifier to the RUM
 * ingestion endpoint. Best-effort by construction (a plain string replace,
 * not real route matching): an imperfect pattern for a pathological edge
 * case (a param value that happens to also appear as a literal path
 * segment elsewhere) costs a slightly-off analytics label, never a real
 * bug — this data feeds an aggregate performance dashboard, not anything
 * pathname-exact.
 */
export function toRoutePattern(
  pathname: string,
  params: Record<string, string | string[]>,
): string {
  let pattern = pathname
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value]
    for (const segmentValue of values) {
      if (segmentValue) pattern = pattern.split(segmentValue).join(`[${key}]`)
    }
  }
  return pattern
}

export function reportWebVitalToRum(metric: WebVitalsMetric, path: string): void {
  if (!ACCEPTED_METRICS.has(metric.name)) return

  const rating =
    metric.rating === 'good' || metric.rating === 'needs-improvement' || metric.rating === 'poor'
      ? metric.rating
      : 'poor' // web-vitals never actually sends anything else; a fallback rather than silently dropping a real metric on an unexpected value

  const body = JSON.stringify({
    metric: metric.name,
    value: metric.value,
    rating,
    path,
    navigationType: metric.navigationType,
  })

  // sendBeacon over fetch: guaranteed to be attempted even when this fires
  // during page unload (CLS/INP routinely do), which a normal fetch is not.
  // Its own return value (false = the browser refused to queue it, e.g. the
  // payload exceeded its size quota) isn't useful to act on here — there is
  // no fallback that would do any better mid-unload, and losing an
  // occasional sample is an acceptable trade-off for this endpoint.
  navigator.sendBeacon(`${API_BASE_URL}/rum`, new Blob([body], { type: 'application/json' }))
}
