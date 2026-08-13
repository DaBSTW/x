import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('collapses same-post likes from different accounts into one notification row (ROADMAP.md 1.7)', async ({
  browser,
}) => {
  // Four real signups plus three real like round trips through the BullMQ
  // notifications worker — more real work than the default budget assumes,
  // same reasoning as realtime-recovery.spec.ts's own test.setTimeout.
  test.setTimeout(90_000)

  const authorContext = await browser.newContext()
  const authorPage = await authorContext.newPage()
  await signUpAndLogIn(authorPage, 'grpauthor')

  const postText = `post con varios likes ${Date.now()}`
  await authorPage.getByPlaceholder('¿Qué está pasando?').fill(postText)
  await authorPage.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(authorPage.getByText(postText)).toBeVisible()

  // PostCard's timestamp links to the post's own permalink
  // (/{username}/status/{id}) — grabbing it here means every liker below
  // can navigate straight to the exact same post without threading its id
  // through three separate account contexts by hand.
  const postHref = await authorPage.locator('a[href*="/status/"]').first().getAttribute('href')
  if (!postHref) throw new Error('expected the freshly-posted post to have a permalink')

  for (const prefix of ['grplikerone', 'grplikertwo', 'grplikerthr']) {
    const likerContext = await browser.newContext()
    const likerPage = await likerContext.newPage()
    await signUpAndLogIn(likerPage, prefix)

    await likerPage.goto(postHref)
    await likerPage.waitForLoadState('networkidle')
    // Same SessionBootstrap-vs-click race social.spec.ts and
    // realtime-badge.spec.ts already guard against — a fresh navigation
    // straight to a public page like this one.
    await likerPage.waitForTimeout(500)
    // Waits on the network round trip itself, not the button's own visual
    // state — a post's own permalink page (app/[username]/status/[id]) is a
    // real Server Component whose SSR fetch (server-api-client.ts) is
    // deliberately anonymous, the same reasoning ROADMAP.md 1.6 already
    // documents for the profile page. GET /posts/:id/thread does compute
    // `viewer` correctly server-side once a real token reaches it, but
    // nothing here re-fetches it *with* one the way
    // use-profile-viewer-state.ts does for viewer.following — so unlike
    // that gap, this one's still genuinely open (see ROADMAP.md 2.1's note).
    const likeResponse = likerPage.waitForResponse(
      (response) => response.url().includes('/like') && response.request().method() === 'POST',
    )
    await likerPage.getByRole('button', { name: 'Me gusta' }).click()
    await likeResponse

    await likerContext.close()
  }

  await authorPage.goto('/notifications')
  // Real pipeline round trip for all three likes (posts/interactions
  // service → BullMQ → apps/workers' notifications processor → Postgres) —
  // poll instead of assuming the last one landed by the time this loads.
  await expect(authorPage.getByText(/y 2 más le dieron me gusta a tu post/)).toBeVisible({
    timeout: 15_000,
  })
  // The real proof of the collapse, not just that the right text exists
  // somewhere: three likes produced three separate `notifications` rows
  // (group_key ties them together, but doesn't merge them at the database
  // level — apps/api/src/modules/notifications never collapses anything,
  // ROADMAP.md 1.7's own note on why this is a display concern only), so
  // an ungrouped render would show three <article> rows here, not one.
  await expect(authorPage.getByRole('article')).toHaveCount(1)

  await authorContext.close()
})
