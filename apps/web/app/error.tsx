'use client'

import { Button } from '@/components/ui/button'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Client-side error reporting (Sentry) lands in a later phase — CODESTYLE.md §15.2.
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Algo salió mal</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Ha ocurrido un error inesperado. Puedes intentarlo de nuevo.
      </p>
      <Button onClick={reset}>Reintentar</Button>
    </div>
  )
}
