'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLogin, useTwoFactorLogin } from '@/lib/use-auth-mutations'
import { zodResolver } from '@hookform/resolvers/zod'
import { type LoginRequest, loginRequestSchema } from '@x/contracts'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

export default function LoginPage() {
  const router = useRouter()
  const login = useLogin()
  const twoFactorLogin = useTwoFactorLogin()
  // Set only once useLogin() comes back 'requires_two_factor' — its
  // presence, not a separate step flag, is what switches the password form
  // below for the code form. Same pattern as apps/web's own login page.
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema) })

  const onSubmit = handleSubmit((values) => {
    login.mutate(values, {
      onSuccess: (result) => {
        if (result.status === 'authenticated') {
          router.push('/queue')
        } else {
          setChallengeToken(result.challengeToken)
        }
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'No se pudo iniciar sesión.')
      },
    })
  })

  function onSubmitCode(event: React.FormEvent) {
    event.preventDefault()
    if (!challengeToken) return
    twoFactorLogin.mutate(
      { challengeToken, code },
      {
        onSuccess: () => router.push('/queue'),
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'Código incorrecto.')
        },
      },
    )
  }

  if (challengeToken) {
    return (
      <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
        <h1 className="text-2xl font-semibold">Verificación en dos pasos</h1>
        <form onSubmit={onSubmitCode} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="code" className="text-sm font-medium">
              Código de tu app de autenticación o un código de recuperación
            </label>
            <Input
              id="code"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={twoFactorLogin.isPending || code.length === 0}>
            {twoFactorLogin.isPending ? 'Verificando…' : 'Verificar'}
          </Button>
          <button
            type="button"
            className="text-sm text-muted-foreground underline"
            onClick={() => setChallengeToken(null)}
          >
            Volver
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Panel de moderación</h1>
        <p className="text-sm text-muted-foreground">
          Inicia sesión con tu cuenta — el acceso de moderador se comprueba después.
        </p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            Contraseña
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
          {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
        </div>
        <Button type="submit" disabled={login.isPending}>
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </main>
  )
}
