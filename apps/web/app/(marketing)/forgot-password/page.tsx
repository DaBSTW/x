'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useForgotPassword } from '@/lib/use-auth-mutations'
import { zodResolver } from '@hookform/resolvers/zod'
import { type ForgotPasswordRequest, forgotPasswordRequestSchema } from '@x/contracts'
import Link from 'next/link'
import { useForm } from 'react-hook-form'

export default function ForgotPasswordPage() {
  const forgotPassword = useForgotPassword()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordRequest>({ resolver: zodResolver(forgotPasswordRequestSchema) })

  const onSubmit = handleSubmit((values) => {
    forgotPassword.mutate(values)
  })

  // The API always responds the same way whether or not the email is
  // registered (SPECS.md §11.3) — the UI mirrors that by showing one message
  // regardless of outcome, never a per-email success/failure state.
  if (forgotPassword.isSuccess) {
    return (
      <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Revisa tu email</h1>
        <p className="text-sm text-muted-foreground">
          Si existe una cuenta con ese email, te hemos enviado un enlace para restablecer tu
          contraseña.
        </p>
        <Link href="/login" className="text-sm text-primary underline">
          Volver a iniciar sesión
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Restablecer contraseña</h1>
      <p className="text-sm text-muted-foreground">
        Introduce tu email y te enviaremos un enlace para elegir una contraseña nueva.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
        <Button type="submit" disabled={forgotPassword.isPending}>
          {forgotPassword.isPending ? 'Enviando…' : 'Enviar enlace'}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary underline">
          Volver a iniciar sesión
        </Link>
      </p>
    </main>
  )
}
