import { z } from 'zod'

// ROADMAP.md 3.4g / SPECS.md §14's Core Web Vitals RUM. One request per
// metric (apps/web's reporter calls this once per web-vitals callback, not
// batched — see its own comment on why), matching @x/utils' own
// RumMetricName/RumRating.
export const rumMetricNameSchema = z.enum(['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'])
export const rumRatingSchema = z.enum(['good', 'needs-improvement', 'poor'])

export const reportRumMetricRequestSchema = z.object({
  metric: rumMetricNameSchema,
  value: z.number().finite(),
  rating: rumRatingSchema,
  // A route *pattern* ("/[username]"), never the concrete path — see
  // apps/web's reporter for how that's derived. Capped well above any real
  // route in this app; a caller sending something absurd here is trying to
  // abuse the endpoint, not report a real metric.
  path: z.string().min(1).max(200),
  navigationType: z.string().min(1).max(50),
})
export type ReportRumMetricRequest = z.infer<typeof reportRumMetricRequestSchema>
