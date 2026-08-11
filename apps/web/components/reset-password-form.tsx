'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useResetPassword } from '@/lib/use-auth-mutations'
import { zodResolver } from '@hookform/resolvers/zod'
import { type ResetPasswordRequest, resetPasswordRequestSchema } from '@x/contracts'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

export function ResetPasswordForm() {
  const router = useRouter()
  const token = useSearchParams().get('token') ?? ''
  const resetPassword = useResetPassword()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordRequest>({
    resolver: zodResolver(resetPasswordRequestSchema),
    defaultValues: { token },
  })

  const onSubmit = handleSubmit((values) => {
    resetPassword.mutate(values, {
      onSuccess: () => {
        toast.success('Contraseña actualizada. Inicia sesión con tu nueva contraseña.')
        router.push('/login')
      },
      onError: (error) => {
        toast.error(
          error instanceof Error ? error.message : 'El enlace no es válido o ha caducado.',
        )
      },
    })
  })

  if (!token) {
    return (
      <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Enlace no válido</h1>
        <p className="text-sm text-muted-foreground">
          Falta el token de restablecimiento. Solicita un enlace nuevo.
        </p>
        <Link href="/forgot-password" className="text-sm text-primary underline">
          Solicitar enlace
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Elige una contraseña nueva</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <input type="hidden" {...register('token')} />
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            Contraseña nueva
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            {...register('password')}
          />
          {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
        </div>
        <Button type="submit" disabled={resetPassword.isPending}>
          {resetPassword.isPending ? 'Guardando…' : 'Guardar contraseña'}
        </Button>
      </form>
    </main>
  )
}
