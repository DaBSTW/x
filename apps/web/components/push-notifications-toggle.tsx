'use client'

import { Button } from '@/components/ui/button'
import { usePushSubscription } from '@/lib/use-push-subscription'
import { toast } from 'sonner'

export function PushNotificationsToggle() {
  const { isSupported, isConfigured, state, isPending, subscribe, unsubscribe } =
    usePushSubscription()

  if (!isSupported) {
    return (
      <p className="text-sm text-muted-foreground">Tu navegador no admite notificaciones push.</p>
    )
  }
  if (!isConfigured) {
    return (
      <p className="text-sm text-muted-foreground">
        Las notificaciones push no están configuradas en este servidor.
      </p>
    )
  }

  const isSubscribed = state === 'subscribed'

  async function onClick() {
    try {
      if (isSubscribed) {
        await unsubscribe()
        toast.success('Notificaciones push desactivadas en este dispositivo.')
      } else {
        await subscribe()
        toast.success('Notificaciones push activadas en este dispositivo.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la suscripción.')
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground">
        {isSubscribed
          ? 'Activadas en este dispositivo.'
          : 'Recibe notificaciones aunque no tengas X abierto.'}
      </p>
      <Button
        type="button"
        variant={isSubscribed ? 'outline' : 'default'}
        onClick={onClick}
        disabled={isPending}
      >
        {isSubscribed ? 'Desactivar' : 'Activar'}
      </Button>
    </div>
  )
}
