'use client'

import { Composer } from '@/components/composer'
import { QuotedPostCard } from '@/components/quoted-post-card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useQuoteComposerStore } from '@/lib/quote-composer-store'

/**
 * ROADMAP.md 2.1 "Citas" — the compose surface <PostCard>'s "Citar" button
 * opens. Mounted once near the app shell root, same pattern as
 * <KeyboardShortcutsDialog>: global state (useQuoteComposerStore) instead of
 * prop-drilling which post is being quoted through every feed that renders
 * <PostCard>.
 */
export function QuoteComposerDialog() {
  const quotedPost = useQuoteComposerStore((state) => state.quotedPost)
  const close = useQuoteComposerStore((state) => state.close)

  return (
    <Dialog open={quotedPost !== null} onOpenChange={(isOpen) => !isOpen && close()}>
      <DialogContent>
        <DialogTitle>Citar post</DialogTitle>
        {quotedPost && (
          <div className="flex flex-col gap-2">
            <Composer
              quotedPostId={quotedPost.id}
              placeholder="Añade un comentario"
              onPosted={close}
            />
            <QuotedPostCard post={quotedPost} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
