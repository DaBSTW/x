'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  useConfirmTwoFactor,
  useDisableTwoFactor,
  useSetupTwoFactor,
  useTwoFactorStatus,
} from '@/lib/use-two-factor'
import { useState } from 'react'
import { toast } from 'sonner'

type SetupData = { secret: string; otpauthUrl: string; qrCodeDataUrl: string }

/** ROADMAP.md 2.6: TOTP setup with QR, confirmation, and one-time recovery codes. */
export function TwoFactorSettings() {
  const { data: status, isLoading } = useTwoFactorStatus()
  const setup = useSetupTwoFactor()
  const confirm = useConfirmTwoFactor()
  const disable = useDisableTwoFactor()

  const [setupData, setSetupData] = useState<SetupData | null>(null)
  const [code, setCode] = useState('')
  // Shown exactly once, in the dialog below — closing it just clears local
  // state, the server never hands them back again (auth.service.ts).
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [isDisabling, setIsDisabling] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')

  function onStartSetup() {
    setup.mutate(undefined, {
      onSuccess: (data) => setSetupData(data),
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'No se pudo iniciar la configuración.')
      },
    })
  }

  function onConfirm(event: React.FormEvent) {
    event.preventDefault()
    confirm.mutate(code, {
      onSuccess: (data) => {
        setSetupData(null)
        setCode('')
        setRecoveryCodes(data.recoveryCodes)
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Código incorrecto.')
      },
    })
  }

  function onDisable(event: React.FormEvent) {
    event.preventDefault()
    disable.mutate(currentPassword, {
      onSuccess: () => {
        setIsDisabling(false)
        setCurrentPassword('')
        toast.success('Verificación en dos pasos desactivada.')
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'No se pudo desactivar.')
      },
    })
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {isLoading || !status ? (
        <p className="text-muted-foreground">Cargando…</p>
      ) : status.enabled ? (
        isDisabling ? (
          <form onSubmit={onDisable} className="flex max-w-xs flex-col gap-2">
            <label htmlFor="disable-2fa-password" className="font-medium">
              Confirma tu contraseña para desactivarla
            </label>
            <Input
              id="disable-2fa-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" variant="outline" disabled={disable.isPending}>
                {disable.isPending ? 'Desactivando…' : 'Confirmar'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIsDisabling(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p>Verificación en dos pasos activada.</p>
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => setIsDisabling(true)}
            >
              Desactivar
            </Button>
          </>
        )
      ) : setupData ? (
        <form onSubmit={onConfirm} className="flex max-w-xs flex-col gap-3">
          <img
            src={setupData.qrCodeDataUrl}
            alt="Código QR para configurar la verificación en dos pasos"
            className="size-48 self-center"
          />
          <p className="text-muted-foreground">
            Escanéalo con tu app de autenticación o escribe este código manualmente:
          </p>
          <code className="break-all rounded bg-muted p-2 text-xs">{setupData.secret}</code>
          <div className="flex flex-col gap-1">
            <label htmlFor="setup-2fa-code" className="font-medium">
              Código de 6 dígitos
            </label>
            <Input
              id="setup-2fa-code"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={confirm.isPending || code.length === 0}>
              {confirm.isPending ? 'Confirmando…' : 'Confirmar'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSetupData(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={onStartSetup}
          disabled={setup.isPending}
        >
          {setup.isPending ? 'Generando…' : 'Activar verificación en dos pasos'}
        </Button>
      )}

      <Dialog
        open={recoveryCodes !== null}
        onOpenChange={(open) => !open && setRecoveryCodes(null)}
      >
        <DialogContent>
          <DialogTitle>Guarda tus códigos de recuperación</DialogTitle>
          <DialogDescription>
            Úsalos para entrar si pierdes acceso a tu app de autenticación. Cada uno funciona una
            sola vez y no volverán a mostrarse.
          </DialogDescription>
          <ul
            aria-label="Códigos de recuperación"
            className="grid grid-cols-2 gap-2 font-mono text-sm"
          >
            {recoveryCodes?.map((recoveryCode) => (
              <li key={recoveryCode}>{recoveryCode}</li>
            ))}
          </ul>
          <Button type="button" onClick={() => setRecoveryCodes(null)} className="mt-4 self-end">
            Ya los guardé
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
