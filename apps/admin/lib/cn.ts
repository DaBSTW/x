import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merges Tailwind class lists, resolving conflicts (last one wins). Same as apps/web's own lib/cn.ts — CODESTYLE.md §7, duplicated rather than shared for a one-line helper neither app depends on the other having. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
