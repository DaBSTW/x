import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

// Real push delivery (subscribing via the browser's own push service) isn't
// exercised here — global-setup.ts's stack has no VAPID keypair configured
// on purpose, the same way a self-hosted deploy would look before an admin
// sets one up, and that's itself a state worth covering. The preferences
// half is independent of whether push is configured at all (they only
// matter once a subscription exists to check them against), so it's
// covered fully against the real API.
test('shows push as unconfigured and persists a per-kind, per-channel preference toggle (ROADMAP.md 2.9)', async ({
  page,
}) => {
  await signUpAndLogIn(page, 'pushcfg')
  await page.goto('/settings')

  await expect(
    page.getByText('Las notificaciones push no están configuradas en este servidor.'),
  ).toBeVisible()

  // Each row now has two checkboxes ("En la app" / "Push") — exact: true
  // throughout, since "Me gusta" alone would match both this row's own
  // in-app and push checkboxes via substring (their accessible names are
  // "En la app: Me gusta" / "Push: Me gusta"), the same class of collision
  // this suite has hit before with plain label/text matches.
  const likeInApp = page.getByLabel('En la app: Me gusta', { exact: true })
  const likePush = page.getByLabel('Push: Me gusta', { exact: true })
  const followPush = page.getByLabel('Push: Nuevos seguidores', { exact: true })

  await expect(likeInApp).toBeChecked() // in_app defaults to on for every kind
  await expect(likePush).not.toBeChecked() // push defaults off for high-volume kinds
  await expect(followPush).toBeChecked() // push defaults on for follow (SPECS.md §13.2)

  await likePush.click()
  await expect(likePush).toBeChecked()
  await likeInApp.click()
  await expect(likeInApp).not.toBeChecked()

  await page.reload()
  await expect(page.getByLabel('Push: Me gusta', { exact: true })).toBeChecked()
  await expect(page.getByLabel('En la app: Me gusta', { exact: true })).not.toBeChecked()
  await expect(page.getByLabel('Push: Nuevos seguidores', { exact: true })).toBeChecked()
})
