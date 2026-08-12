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
  // providers.tsx's <SessionBootstrap> restores the access token from the
  // refresh cookie asynchronously — networkidle covers its own /auth/refresh
  // request completing, but not React committing the resulting store update
  // in time for an instant click right after (same class of after-
  // networkidle gap as this file's own waitForTimeout below, and
  // thread-view.spec.ts's JIT-compile race comment).
  await followerPage.waitForTimeout(500)
  await followerPage.getByRole('button', { name: 'Seguir' }).click()
  await expect(followerPage.getByRole('button', { name: 'Siguiendo' })).toBeVisible()

  // Land on the follower's own timeline and let the realtime connection
  // establish before the followee posts. networkidle covers the page's own
  // HTTP requests, including the WS upgrade handshake itself — but the
  // "subscribe" frame sent right after over that now-open socket is a
  // WebSocket message, not a network request Playwright tracks, so a post
  // created the instant networkidle resolves can race ahead of the
  // subscribe ack and get published to a channel nobody's listening on yet
  // (PUBLISH to zero subscribers is simply dropped). This specific race is
  // still a real gap even after realtime-recovery.spec.ts's `since` fix: a
  // *first-ever* subscribe has no prior eventId to send, so there's nothing
  // to replay from — recovery only ever covers what's missed *between* two
  // subscribes on the same hook instance, never before the first one. Same
  // class of test-environment-only timing gap as thread-view.spec.ts's own
  // comment on the JIT-compile race, same fix.
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
