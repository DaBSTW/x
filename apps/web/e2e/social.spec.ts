import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('following a user creates a notification for them', async ({ browser }) => {
  const followeeContext = await browser.newContext()
  const followerContext = await browser.newContext()
  const followeePage = await followeeContext.newPage()
  const followerPage = await followerContext.newPage()

  const followeeUsername = await signUpAndLogIn(followeePage, 'followee')
  await signUpAndLogIn(followerPage, 'follower')

  await followerPage.goto(`/${followeeUsername}`)
  // A fresh navigation has no in-memory access token yet (it lives in
  // memory only — auth-store.ts) — networkidle gives the silent
  // refresh-cookie bootstrap (providers.tsx's <SessionBootstrap>) a chance
  // to finish before the click below needs it.
  await followerPage.waitForLoadState('networkidle')
  await followerPage.getByRole('button', { name: 'Seguir' }).click()
  await expect(followerPage.getByRole('button', { name: 'Siguiendo' })).toBeVisible()

  // The notification is written by a real BullMQ worker consuming a real
  // queue — poll instead of assuming it landed the instant follow resolved.
  await followeePage.goto('/notifications')
  await expect(followeePage.getByText('empezó a seguirte')).toBeVisible({ timeout: 15_000 })

  await followeeContext.close()
  await followerContext.close()
})
