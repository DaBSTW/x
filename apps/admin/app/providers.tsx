'use client'

import { createQueryClient } from '@/lib/query-client'
import { useSession } from '@/lib/use-session'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Toaster } from 'sonner'

/** Establishes the in-memory access token from the httpOnly refresh cookie on first load, on every page — same reasoning as apps/web's own Providers/SessionBootstrap. */
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
