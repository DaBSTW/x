import { ChangePasswordForm } from '@/components/change-password-form'

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="border-b border-border pb-4 text-xl font-bold">Configuración</h1>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Contraseña</h2>
        <ChangePasswordForm />
      </section>
    </div>
  )
}
