import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('a followed account posting shows the "N posts nuevos" badge on the follower\'s own timeline, live (ROADMAP.md 2.2)', async ({
  browser,
}) => {
  const followeeContext = await browser.newContext()
  const followerContext = await browser.newContext()
  const followeePage = await followeeContext.newPage()
  const followerPage = await followerContext.newPage()

  const followeeUsername = await signUpAndLogIn(followeePage, 'rtfollowee')
  await signUpAndLogIn(followerPage, 'rtfollower')

  await followerPage.goto(`/${followeeUsername}`)
  await followerPage.waitForLoadState('networkidle')
  await followerPage.getByRole('button', { name: 'Seguir' }).click()
  await expect(followerPage.getByRole('button', { name: 'Siguiendo' })).toBeVisible()

  // Land on the follower's own timeline and let the realtime connection
  // establish before the followee posts. networkidle covers the page's own
  // HTTP requests, including the WS upgrade handshake itself — but the
  // "subscribe" frame sent right after over that now-open socket is a
  // WebSocket message, not a network request Playwright tracks, so a post
  // created the instant networkidle resolves can race ahead of the
  // subscribe ack and get published to a channel nobody's listening on yet
  // (PUBLISH to zero subscribers is simply dropped — recovering a dropped
  // event is ROADMAP.md 2.2's still-open Redis Streams bullet, not this
  // one). Same class of test-environment-only timing gap as
  // thread-view.spec.ts's own comment on the JIT-compile race, same fix.
  await followerPage.goto('/home')
  await followerPage.waitForLoadState('networkidle')
  await followerPage.waitForTimeout(1_000)

  const postText = `post en vivo ${Date.now()}`
  await followeePage.getByPlaceholder('¿Qué está pasando?').fill(postText)
  await followeePage.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(followeePage.getByText(postText)).toBeVisible()

  // Real pipeline round trip: posts.service → BullMQ fan-out queue →
  // apps/workers' fanout processor → Redis PUBLISH on timeline:{id} →
  // apps/ws-gateway → the follower's own browser WebSocket — poll instead
  // of assuming it lands within one tick.
  await expect(followerPage.getByRole('button', { name: '1 post nuevo' })).toBeVisible({
    timeout: 15_000,
  })

  await followerPage.getByRole('button', { name: '1 post nuevo' }).click()
  await expect(followerPage.getByText(postText)).toBeVisible()
  await expect(followerPage.getByRole('button', { name: '1 post nuevo' })).not.toBeVisible()

  await followeeContext.close()
  await followerContext.close()
})
