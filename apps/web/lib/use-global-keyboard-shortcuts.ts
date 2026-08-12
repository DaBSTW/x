'use client'

import { useEffect } from 'react'
import { useShortcutsDialogStore } from './shortcuts-dialog-store'

/** True while focus is somewhere a keystroke should be typed, not treated as a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  )
}

/**
 * App-wide shortcuts (SPECS.md §7.5, ROADMAP.md 2.10) — "n" focuses the
 * composer if one happens to be on screen (today, only /home renders one;
 * this is a no-op elsewhere rather than navigating there, since jumping the
 * page out from under someone mid-shortcut is its own surprise) and "?"
 * opens the shortcuts help dialog. Feed-specific shortcuts (j/k/l/t/r) live
 * in use-post-feed-keyboard-nav.ts, scoped to wherever <PostFeedList> is
 * actually mounted instead of listening globally for a feed that isn't there.
 */
export function useGlobalKeyboardShortcuts(): void {
  const openShortcutsDialog = useShortcutsDialogStore((state) => state.open)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      if (event.key === 'n') {
        const composer = document.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Redactar un post"]',
        )
        if (composer) {
          event.preventDefault()
          composer.focus()
        }
      } else if (event.key === '?') {
        event.preventDefault()
        openShortcutsDialog()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [openShortcutsDialog])
}
