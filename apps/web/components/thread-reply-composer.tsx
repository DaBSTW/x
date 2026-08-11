'use client'

import { Composer } from '@/components/composer'
import { useAuthStore } from '@/lib/auth-store'
import { useRouter } from 'next/navigation'

type ThreadReplyComposerProps = {
  postId: string
}

/**
 * The thread page's reply box (ROADMAP.md 2.1) — only rendered for a
 * logged-in visitor; the thread page itself is public, and posting a reply
 * needs an access token <Composer> can't get for someone without a
 * session. `router.refresh()` re-runs the page's own server-side fetch on
 * success, so the new reply shows up without a full reload.
 */
export function ThreadReplyComposer({ postId }: ThreadReplyComposerProps) {
  const router = useRouter()
  const isAuthenticated = useAuthStore((state) => state.accessToken !== null)

  if (!isAuthenticated) return null

  return (
    <Composer
      inReplyToId={postId}
      placeholder="Postea tu respuesta"
      onPosted={() => router.refresh()}
    />
  )
}
