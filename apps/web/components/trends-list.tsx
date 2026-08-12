'use client'

import { cn } from '@/lib/cn'
import { formatCompactNumber } from '@/lib/format'
import { useTrends } from '@/lib/use-trends'
import { useState } from 'react'

// Region (WOEID) segmentation from SPECS.md §10.4 isn't built — no
// geocoding provider available (ROADMAP.md 2.4) — so this is language-only,
// and just the one concrete language beyond "global" rather than a list
// pulled from anywhere: the public User contract doesn't expose a preferred
// language to default to yet, and there's no endpoint yet that reports
// which languages currently have an active snapshot for a fuller list.
const SCOPES: Array<{ label: string; lang: string | undefined }> = [
  { label: 'Global', lang: undefined },
  { label: 'Español', lang: 'es' },
]

/**
 * ROADMAP.md 2.4 / SPECS.md §10.4. Hashtags aren't links to a search
 * results page — 2.3 (búsqueda) doesn't exist yet, so there's nowhere for
 * one to go; showing a broken link would be worse than showing plain text.
 */
export function TrendsList() {
  const [scopeIndex, setScopeIndex] = useState(0)
  const scope = SCOPES[scopeIndex] ?? SCOPES[0]
  const { data: trends, isLoading } = useTrends({
    ...(scope?.lang !== undefined && { lang: scope.lang }),
    limit: 20,
  })

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Alcance de las tendencias" className="flex gap-2">
        {SCOPES.map((option, index) => (
          <button
            key={option.label}
            type="button"
            role="tab"
            aria-selected={index === scopeIndex}
            onClick={() => setScopeIndex(index)}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-medium transition-colors',
              index === scopeIndex
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando tendencias…</p>
      ) : !trends || trends.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay suficiente actividad para mostrar tendencias.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {trends.map((trend, index) => (
            <li key={trend.hashtag} className="flex items-center gap-3 py-3">
              <span className="w-5 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <div className="flex flex-1 flex-col">
                <span className="font-semibold">#{trend.hashtag}</span>
                <span className="text-sm text-muted-foreground">
                  {formatCompactNumber(trend.postCount1h)} posts ·{' '}
                  {formatCompactNumber(trend.uniqueAuthors1h)} personas
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
