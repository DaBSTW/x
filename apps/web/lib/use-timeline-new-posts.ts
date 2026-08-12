'use client'

// Subpath import, not the bare package — the main barrel (`@x/utils`)
// re-exports password.ts, which pulls in @node-rs/argon2's native binding.
// A bundler follows that import graph even for an unused export, and fails
// trying to parse a `.node` binary as JS (ROADMAP.md 2.2, found by actually
// running `next build`, not just `tsc --noEmit`, which doesn't bundle).
import { timelineChannel } from '@x/utils/realtime'
import { useCallback, useState } from 'react'
import { useRealtimeChannel } from './use-realtime-channel'

/**
 * "N posts nuevos" badge (ROADMAP.md 2.2, SPECS.md §8.2's `timeline:{id}`
 * channel) — counts `post.available` events since the last `reset()` (the
 * caller resets it once it's actually shown the new posts, e.g. after a
 * refetch). `userId` is `undefined` until the session resolves, same
 * "nothing to subscribe to yet" idle state `useRealtimeChannel` itself
 * accepts.
 */
export function useTimelineNewPosts(userId: string | undefined): {
  count: number
  reset: () => void
} {
  const [count, setCount] = useState(0)

  useRealtimeChannel(
    userId ? timelineChannel(userId) : undefined,
    useCallback((event) => {
      if (event.event === 'post.available') setCount((current) => current + 1)
    }, []),
  )

  return { count, reset: useCallback(() => setCount(0), []) }
}
