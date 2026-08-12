'use client'

import type { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useEffect } from 'react'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  )
}

/** -1 when nothing in this feed currently has DOM focus. */
function currentIndex(container: HTMLElement): number {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !container.contains(active)) return -1
  // closest(), not active.dataset directly: clicking a button — l/t/r below
  // — moves real DOM focus onto that button itself, a descendant of the
  // `[data-index]` wrapper rather than the wrapper. A following j/k still
  // needs to resolve back to that same post's index, not lose it.
  const indexed = active.closest<HTMLElement>('[data-index]')
  const raw = indexed?.dataset.index
  return raw ? Number(raw) : -1
}

function focusIndex(container: HTMLElement, index: number): void {
  container.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus()
}

const ACTION_LABELS: Record<'l' | 't' | 'r', RegExp> = {
  l: /^(Me gusta|Quitar me gusta)$/,
  t: /^(Repostear|Deshacer repost)$/,
  r: /^Responder$/,
}

/**
 * j/k/l/t/r inside a <PostFeedList> (SPECS.md §7.5, ROADMAP.md 2.10) —
 * scoped to this one container's own listener rather than a global one, so
 * it's naturally inert on any page that isn't rendering a feed. j/k move a
 * real roving DOM focus (not just a visual highlight — screen reader users
 * need this, not only sighted ones) between the wrapper `<div data-index>`s
 * post-feed-list.tsx renders; the virtualizer's scrollToIndex runs first
 * since the target may not be mounted yet outside the overscan window, and
 * the double rAF gives its resulting re-render a chance to commit before
 * the query for the now-rendered element. l/t/r act on whichever post
 * currently holds that focus by clicking its existing action button — the
 * same code path a mouse click takes, so there's exactly one implementation
 * of "like a post," not two that could quietly drift apart.
 */
export function usePostFeedKeyboardNav(
  containerRef: React.RefObject<HTMLElement | null>,
  virtualizer: ReturnType<typeof useWindowVirtualizer>,
  itemCount: number,
): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (itemCount === 0) return
      const container = containerRef.current
      if (!container) return

      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault()
        const current = currentIndex(container)
        const next =
          event.key === 'j' ? Math.min(current + 1, itemCount - 1) : Math.max(current - 1, 0)
        if (next === current) return
        virtualizer.scrollToIndex(next, { align: 'auto' })
        requestAnimationFrame(() => requestAnimationFrame(() => focusIndex(container, next)))
        return
      }

      if (event.key === 'l' || event.key === 't' || event.key === 'r') {
        const current = currentIndex(container)
        if (current < 0) return
        const item = container.querySelector<HTMLElement>(`[data-index="${current}"]`)
        const label = ACTION_LABELS[event.key]
        const button = item
          ? [...item.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
              label.test(candidate.getAttribute('aria-label') ?? ''),
            )
          : undefined
        button?.click()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [containerRef, virtualizer, itemCount])
}
