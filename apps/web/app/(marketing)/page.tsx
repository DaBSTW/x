import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-4xl font-bold">X</h1>
      <p className="max-w-md text-muted-foreground">
        Una plataforma de microblogging en tiempo real, abierta y a escala.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/signup">Crear cuenta</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Iniciar sesión</Link>
        </Button>
      </div>
    </main>
  )
}
