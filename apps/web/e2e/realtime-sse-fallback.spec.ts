import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('falls back to SSE and still delivers a live event when WebSocket connections are blocked (ROADMAP.md 2.2)', async ({
  browser,
}) => {
  // Three blocked WS attempts, backing off ~1s then ~2s between them
  // (realtime-backoff.ts's MAX_CONSECUTIVE_TRANSPORT_FAILURES /
  // nextReconnectDelayMs) before use-realtime-channel.ts's cascade gives up
  // on WebSocket and switches to SSE, on top of the same multi-round-trip
  // budget realtime-badge.spec.ts's own test needs — see its comment.
  test.setTimeout(75_000)

  const followeeContext = await browser.newContext()
  const followerContext = await browser.newContext()
  const followeePage = await followeeContext.newPage()
  const followerPage = await followerContext.newPage()

  // Every WebSocket upgrade to apps/ws-gateway's `/v1` is intercepted and
  // closed before it ever opens — the same observable behavior as a
  // corporate proxy stripping the `Upgrade` header, which is the entire
  // scenario this fallback exists for. Scoped to followerPage only: the
  // followee's own connection (if any) stays on the normal WS path, since
  // this test only cares about what the *follower* observes.
  await followerPage.routeWebSocket(/^ws:\/\/localhost:3002\/v1\?/, (ws) => {
    ws.close()
  })

  const followeeUsername = await signUpAndLogIn(followeePage, 'ssefollowee')
  await signUpAndLogIn(followerPage, 'ssefollower')

  await followerPage.goto(`/${followeeUsername}`)
  await followerPage.waitForLoadState('networkidle')
  await followerPage.waitForTimeout(500)
  await followerPage.getByRole('button', { name: 'Seguir' }).click()
  await expect(followerPage.getByRole('button', { name: 'Siguiendo' })).toBeVisible()

  await followerPage.goto('/home')
  await followerPage.waitForLoadState('networkidle')
  // Room for the WS→SSE escalation to actually finish: three failed
  // WebSocket attempts plus the backoff between them, then the SSE
  // connection's own opening handshake and subscribed ack — all of it
  // before the post below is even created, so there's no live-delivery
  // race to lose against a subscribe that hasn't landed yet (same reasoning
  // as realtime-badge.spec.ts's own settling wait, just a longer one since
  // this scenario has three extra round trips ahead of it).
  await followerPage.waitForTimeout(6_000)

  const postText = `post via sse fallback ${Date.now()}`
  await followeePage.getByPlaceholder('¿Qué está pasando?').fill(postText)
  await followeePage.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(followeePage.getByText(postText)).toBeVisible()

  // Real pipeline round trip, same as realtime-badge.spec.ts, only the
  // last hop (apps/ws-gateway → browser) now goes over SSE instead of a
  // WebSocket — proof the fallback doesn't just *connect*, it actually
  // delivers.
  await expect(followerPage.getByRole('button', { name: '1 post nuevo' })).toBeVisible({
    timeout: 15_000,
  })

  await followeeContext.close()
  await followerContext.close()
})
