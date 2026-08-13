import { ChangePasswordForm } from '@/components/change-password-form'
import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPreferencesForm } from '@/components/notification-preferences-form'
import { ProtectedAccountToggle } from '@/components/protected-account-toggle'
import { PushNotificationsToggle } from '@/components/push-notifications-toggle'
import { SessionsList } from '@/components/sessions-list'
import { TwoFactorSettings } from '@/components/two-factor-settings'
import { getTranslations } from 'next-intl/server'

export default async function SettingsPage() {
  const t = await getTranslations('Settings')

  return (
    <div className="flex flex-col gap-8 p-4">
      <h1 className="border-b border-border pb-4 text-xl font-bold">{t('title')}</h1>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('language')}</h2>
        <LanguageSwitcher />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('privacy')}</h2>
        <ProtectedAccountToggle />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('password')}</h2>
        <ChangePasswordForm />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('twoFactor')}</h2>
        <TwoFactorSettings />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('sessions')}</h2>
        <SessionsList />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('pushNotifications')}</h2>
        <PushNotificationsToggle />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('notificationPreferences')}</h2>
        <NotificationPreferencesForm />
      </section>
    </div>
  )
}
