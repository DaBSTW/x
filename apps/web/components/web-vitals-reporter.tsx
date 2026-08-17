'use client'

import { reportWebVitalToRum, toRoutePattern } from '@/lib/report-web-vitals'
import { useParams, usePathname } from 'next/navigation'
import { useReportWebVitals } from 'next/web-vitals'

/**
 * ROADMAP.md 3.4g / SPECS.md §14's Core Web Vitals RUM — mounted once in
 * app/providers.tsx, on every page, deliberately including ones that
 * render before the visitor ever logs in (the landing page 3.4f's own
 * bundle budget targets is exactly one of those).
 */
export function WebVitalsReporter() {
  const pathname = usePathname()
  const params = useParams<Record<string, string | string[]>>()

  useReportWebVitals((metric) => {
    reportWebVitalToRum(metric, toRoutePattern(pathname, params))
  })

  return null
}
