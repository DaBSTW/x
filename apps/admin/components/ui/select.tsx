import { cn } from '@/lib/cn'
import type { SelectHTMLAttributes } from 'react'

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>

// A plain <select> — no @radix-ui/react-select. A moderator picking one of
// 7 well-known action types (or a handful of report categories) doesn't
// need a custom-styled listbox to be usable; the native control is also
// free keyboard/screen-reader support this app doesn't have to re-build.
export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
