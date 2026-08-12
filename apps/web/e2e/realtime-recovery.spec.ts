import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('a reconnect after a dropped connection recovers what was missed while offline, via since (ROADMAP.md 2.2)', async ({
  browser,
}) => {
  // Default 30s (playwright.config.ts) doesn't leave enough room for two
  // full post round trips plus a real offline/online toggle and the
  // reconnect backoff after it — same reasoning as
  // accessibility.spec.ts's own test.setTimeout for its own slow scenario.
  test.setTimeout(75_000)

  const followeeContext = await browser.newContext()
  const followerContext = await browser.newContext()
  const followeePage = await followeeContext.newPage()
  const followerPage = await followerContext.newPage()

  const followeeUsername = await signUpAndLogIn(followeePage, 'rtrecfollowee')
  await signUpAndLogIn(followerPage, 'rtrecfollower')

  await followerPage.goto(`/${followeeUsername}`)
  await followerPage.waitForLoadState('networkidle')
  await followerPage.getByRole('button', { name: 'Seguir' }).click()
  await expect(followerPage.getByRole('button', { name: 'Siguiendo' })).toBeVisible()

  // Same settling wait as realtime-badge.spec.ts, same reason: give the
  // WebSocket's own "subscribe" frame (not tracked by networkidle) time to
  // land before the first post below.
  await followerPage.goto('/home')
  await followerPage.waitForLoadState('networkidle')
  await followerPage.waitForTimeout(1_000)

  // Received live — this is also what seeds the hook's own lastEventId,
  // the thing that makes the recovery below possible at all (an id has to
  // exist before it can be sent back as `since`).
  const firstPost = `post en vivo antes del corte ${Date.now()}`
  await followeePage.getByPlaceholder('¿Qué está pasando?').fill(firstPost)
  await followeePage.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(followeePage.getByText(firstPost)).toBeVisible()
  await expect(followerPage.getByRole('button', { name: '1 post nuevo' })).toBeVisible({
    timeout: 15_000,
  })

  // Chromium's offline emulation resets active sockets, not just new
  // requests — the gateway sees a real close, so use-realtime-channel.ts's
  // own onclose → scheduleReconnect fires just like a genuine network blip.
  await followerContext.setOffline(true)
  await followerPage.waitForTimeout(500)

  // Published while the follower has no live subscriber on this channel —
  // PUBLISH to zero subscribers is simply dropped (same fact
  // realtime-badge.spec.ts's own comment relies on). The *only* way this
  // ever reaches the follower from here is the Redis Streams replay this
  // test exists to prove is actually triggered now — the gateway side of
  // that replay was already covered end to end by
  // apps/ws-gateway's own gateway.integration.test.ts; what was missing was
  // the client ever asking for it.
  const missedPost = `post perdido durante el corte ${Date.now()}`
  await followeePage.getByPlaceholder('¿Qué está pasando?').fill(missedPost)
  await followeePage.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(followeePage.getByText(missedPost)).toBeVisible()

  await followerContext.setOffline(false)

  // Reconnect (exponential backoff + jitter, up to 30s) resubscribes with
  // `since` set to the first post's eventId — both events end up counted,
  // not just the one that arrived live.
  await expect(followerPage.getByRole('button', { name: '2 posts nuevos' })).toBeVisible({
    timeout: 40_000,
  })

  await followerPage.getByRole('button', { name: '2 posts nuevos' }).click()
  await expect(followerPage.getByText(firstPost)).toBeVisible()
  await expect(followerPage.getByText(missedPost)).toBeVisible()

  await followeeContext.close()
  await followerContext.close()
})
