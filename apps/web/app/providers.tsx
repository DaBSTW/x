'use client'

import { createQueryClient } from '@/lib/query-client'
import { useSession } from '@/lib/use-session'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Toaster } from 'sonner'

/**
 * Establishes the in-memory access token from the httpOnly refresh cookie
 * on first load, on *every* page — not just the ones (app)/layout.tsx
 * gates. Without this, a logged-in visitor landing directly on a public
 * page (a shared profile or post link, never having passed through /home
 * first) has no access token yet, so an authenticated action there — like
 * following — fails with a silent 401 (found via e2e/social.spec.ts, not
 * something a unit or integration test exercises). (app)/layout.tsx still
 * calls useSession() itself for its own redirect-gating; same TanStack
 * Query key, so this never double-fetches.
 */
function SessionBootstrap({ children }: { children: React.ReactNode }) {
  useSession()
  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <SessionBootstrap>{children}</SessionBootstrap>
      <Toaster richColors position="bottom-right" />
    </QueryClientProvider>
  )
}
