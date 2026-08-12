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
  // Freshly seeded from `useProfileViewerState` (ROADMAP.md 1.6/1.4) — not
  // yet following, so "Seguir", not a stale default that happens to agree.
  await expect(followerPage.getByRole('button', { name: 'Seguir' })).toBeVisible()
  await followerPage.getByRole('button', { name: 'Seguir' }).click()
  await expect(followerPage.getByRole('button', { name: 'Siguiendo' })).toBeVisible()

  // The notification is written by a real BullMQ worker consuming a real
  // queue — poll instead of assuming it landed the instant follow resolved.
  await followeePage.goto('/notifications')
  await expect(followeePage.getByText('empezó a seguirte')).toBeVisible({ timeout: 15_000 })

  // ROADMAP.md 1.6/1.4: GET /users/:username's viewer.following now backs
  // <FollowButton>'s *initial* state too, not just the optimistic update
  // above — a reload re-mounts the component from scratch (no client
  // mutation cache to fall back on for "am I following"), so this only
  // stays "Siguiendo" if the fetched viewer state is what actually seeds it.
  await followerPage.reload()
  await followerPage.waitForLoadState('networkidle')
  await expect(followerPage.getByRole('button', { name: 'Siguiendo' })).toBeVisible()

  await followeeContext.close()
  await followerContext.close()
})
