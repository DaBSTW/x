'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useChangePassword } from '@/lib/use-auth-mutations'
import { zodResolver } from '@hookform/resolvers/zod'
import { type ChangePasswordRequest, changePasswordRequestSchema } from '@x/contracts'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

export function ChangePasswordForm() {
  const changePassword = useChangePassword()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordRequest>({ resolver: zodResolver(changePasswordRequestSchema) })

  const onSubmit = handleSubmit((values) => {
    changePassword.mutate(values, {
      onSuccess: () => {
        toast.success('Contraseña actualizada. Se cerró la sesión en tus otros dispositivos.')
        reset()
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'No se pudo cambiar la contraseña.')
      },
    })
  })

  return (
    <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="currentPassword" className="text-sm font-medium">
          Contraseña actual
        </label>
        <Input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          {...register('currentPassword')}
        />
        {errors.currentPassword && (
          <p className="text-sm text-destructive">{errors.currentPassword.message}</p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="newPassword" className="text-sm font-medium">
          Contraseña nueva
        </label>
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          {...register('newPassword')}
        />
        {errors.newPassword && (
          <p className="text-sm text-destructive">{errors.newPassword.message}</p>
        )}
      </div>
      <Button type="submit" disabled={changePassword.isPending} className="self-start">
        {changePassword.isPending ? 'Guardando…' : 'Cambiar contraseña'}
      </Button>
    </form>
  )
}
