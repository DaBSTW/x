import type { Post } from '@x/contracts'
import { create } from 'zustand'

type QuoteComposerState = {
  /** The post being quoted, or `null` when the dialog is closed — the dialog's own `open` prop derives from this instead of a separate boolean, so there's never a stale post left behind a closed dialog. */
  quotedPost: Post | null
  open: (post: Post) => void
  close: () => void
}

/** Global, so <PostCard>'s "Citar" button — any feed, any depth — can open it without prop-drilling, same non-persisted shape as shortcuts-dialog-store.ts. */
export const useQuoteComposerStore = create<QuoteComposerState>((set) => ({
  quotedPost: null,
  open: (post) => set({ quotedPost: post }),
  close: () => set({ quotedPost: null }),
}))
