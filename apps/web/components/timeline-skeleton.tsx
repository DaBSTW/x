// Stable, human-authored keys instead of the array index (CODESTYLE.md §11's
// "toda key de lista es un ID estable, nunca el índice") — these rows have
// no real identity, but a literal string is free and avoids the exception.
const SKELETON_ROWS = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5']

export function TimelineSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col">
      {SKELETON_ROWS.map((key) => (
        <div key={key} className="flex gap-3 border-b border-border p-4">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <div className="h-3 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}
