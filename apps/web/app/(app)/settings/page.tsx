import { ChangePasswordForm } from '@/components/change-password-form'
import { NotificationPreferencesForm } from '@/components/notification-preferences-form'
import { ProtectedAccountToggle } from '@/components/protected-account-toggle'
import { PushNotificationsToggle } from '@/components/push-notifications-toggle'
import { SessionsList } from '@/components/sessions-list'
import { TwoFactorSettings } from '@/components/two-factor-settings'

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-8 p-4">
      <h1 className="border-b border-border pb-4 text-xl font-bold">Configuración</h1>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Privacidad</h2>
        <ProtectedAccountToggle />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Contraseña</h2>
        <ChangePasswordForm />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Verificación en dos pasos</h2>
        <TwoFactorSettings />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Sesiones activas</h2>
        <SessionsList />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Notificaciones push</h2>
        <PushNotificationsToggle />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Qué notificaciones recibir</h2>
        <NotificationPreferencesForm />
      </section>
    </div>
  )
}
