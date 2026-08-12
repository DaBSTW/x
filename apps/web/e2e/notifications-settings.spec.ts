import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

// Real push delivery (subscribing via the browser's own push service) isn't
// exercised here — global-setup.ts's stack has no VAPID keypair configured
// on purpose, the same way a self-hosted deploy would look before an admin
// sets one up, and that's itself a state worth covering. The preferences
// half is independent of whether push is configured at all (they only
// matter once a subscription exists to check them against), so it's
// covered fully against the real API.
test('shows push as unconfigured and persists a per-kind preference toggle (ROADMAP.md 2.9)', async ({
  page,
}) => {
  await signUpAndLogIn(page, 'pushcfg')
  await page.goto('/settings')

  await expect(
    page.getByText('Las notificaciones push no están configuradas en este servidor.'),
  ).toBeVisible()

  const likeToggle = page.getByLabel('Me gusta')
  const followToggle = page.getByLabel('Nuevos seguidores')
  await expect(likeToggle).not.toBeChecked() // default: off for high-volume kinds
  await expect(followToggle).toBeChecked() // default: on (SPECS.md §13.2)

  await likeToggle.click()
  await expect(likeToggle).toBeChecked()

  await page.reload()
  await expect(page.getByLabel('Me gusta')).toBeChecked()
  await expect(page.getByLabel('Nuevos seguidores')).toBeChecked()
})
