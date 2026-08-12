import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

const API_URL = 'http://localhost:3001/v1'

test('the focused post gets a bigger, distinguished layout and ancestors render root-first (ROADMAP.md 2.1)', async ({
  page,
}) => {
  await signUpAndLogIn(page, 'thread')

  const rootText = `raíz del hilo ${Date.now()}`
  await page.getByPlaceholder('¿Qué está pasando?').fill(rootText)
  await page.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(page.getByText(rootText)).toBeVisible()

  // "Responder" navigates to the post's own thread page — same affordance
  // e2e/keyboard-shortcuts.spec.ts's "r" shortcut exercises.
  await page
    .locator('article', { hasText: rootText })
    .getByRole('button', { name: 'Responder' })
    .click()
  await page.waitForURL(/\/status\//)
  await page.waitForLoadState('networkidle')

  const middleText = `respuesta en medio ${Date.now()}`
  await page.getByPlaceholder('Postea tu respuesta').fill(middleText)
  await page.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(page.getByText(middleText)).toBeVisible()
  // thread-reply-composer.tsx's onPosted calls router.refresh(); let that
  // RSC round trip fully settle before navigating away, or the next
  // Composer instance mounts with the previous fill lost mid-transition.
  await page.waitForLoadState('networkidle')

  // router.refresh() landed the new reply on this same page as the focused
  // post's own reply — reply to *that* to get a real two-deep ancestor
  // chain (root, middle) → leaf.
  await page
    .locator('article', { hasText: middleText })
    .getByRole('button', { name: 'Responder' })
    .click()
  await page.waitForURL(/\/status\//)
  await page.waitForLoadState('networkidle')
  // Next's dev server JIT-compiles a dynamic route the first time it's hit
  // in a session (visible in this run as "Compiling /[username]/status/[id]
  // ..." right around here) — filling and clicking Postear while that's
  // still settling can land the fill on a Composer instance that gets
  // swapped out from under it, leaving an empty (and so permanently
  // disabled) textarea behind. Production has no such on-demand compile
  // step; this is a dev-server-only characteristic of the third
  // navigation+post in one fast, automated flow, not a product race.
  await page.waitForTimeout(1000)

  const leafText = `la hoja del hilo ${Date.now()}`
  await page.getByPlaceholder('Postea tu respuesta').fill(leafText)
  await page.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(page.getByText(leafText)).toBeVisible()
  await page.waitForLoadState('networkidle')

  // Still on middle's own thread page — the leaf just landed as one of
  // *its* replies. Navigate to the leaf's own thread page to get the real
  // two-deep ancestor chain (root, middle) → leaf as the focused post.
  await page
    .locator('article', { hasText: leafText })
    .getByRole('button', { name: 'Responder' })
    .click()
  await page.waitForURL(/\/status\//)

  // Now on the leaf's own thread page: ancestors root-first, then the leaf
  // itself as the focused post.
  const articles = page.locator('article')
  await expect(articles).toHaveCount(3)
  await expect(articles.nth(0)).toContainText(rootText)
  await expect(articles.nth(1)).toContainText(middleText)
  await expect(articles.nth(2)).toContainText(leafText)

  // The focused post (the leaf) shows a full, cross-checkable timestamp
  // ("14:32 · 11 ago 2026") instead of the feed's relative one ("hace 3 h")
  // every other article on this page still uses.
  const focusedArticle = articles.nth(2)
  await expect(focusedArticle.getByText(/^\d{1,2}:\d{2} · /)).toBeVisible()
  await expect(articles.nth(0).getByText(/^\d{1,2}:\d{2} · /)).toHaveCount(0)
  await expect(articles.nth(1).getByText(/^\d{1,2}:\d{2} · /)).toHaveCount(0)
})

test('"cargar más respuestas" loads a reply page beyond the thread endpoint\'s first 20 (ROADMAP.md 2.1)', async ({
  page,
}) => {
  await signUpAndLogIn(page, 'threadmore')

  const rootText = `raíz con más de veinte respuestas ${Date.now()}`
  await page.getByPlaceholder('¿Qué está pasando?').fill(rootText)
  await page.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(page.getByText(rootText)).toBeVisible()

  await page
    .locator('article', { hasText: rootText })
    .getByRole('button', { name: 'Responder' })
    .click()
  await page.waitForURL(/\/status\/(\d+)/)
  const postId = /\/status\/(\d+)/.exec(page.url())?.[1]
  expect(postId).toBeTruthy()

  // A fresh access token via the same httpOnly refresh cookie the UI login
  // already set (page.request shares the page's cookie jar) — the access
  // token itself never touches localStorage (auth-store.ts), so it can't be
  // read off the page directly, only re-derived the same way the app's own
  // SessionBootstrap does on load.
  const refreshResponse = await page.request.post(`${API_URL}/auth/refresh`)
  expect(refreshResponse.ok()).toBe(true)
  const { data: refreshData } = await refreshResponse.json()
  const authHeaders = { authorization: `Bearer ${refreshData.accessToken}` }

  // 21 replies — one more than THREAD_REPLIES_PAGE_SIZE (posts.service.ts)
  // — created directly against the real API instead of 21 slow UI round
  // trips; the point of this test is <ThreadReplies>'s button, not
  // re-proving POST /posts itself.
  for (let i = 0; i < 21; i++) {
    const replyResponse = await page.request.post(`${API_URL}/posts`, {
      headers: authHeaders,
      data: { text: `respuesta número ${i}`, inReplyToId: postId },
    })
    expect(replyResponse.ok()).toBe(true)
  }

  await page.reload()

  const loadMoreButton = page.getByRole('button', { name: 'Cargar más respuestas' })
  await expect(loadMoreButton).toBeVisible()
  // Newest-first: reply 20 (the very last one created) is on the first
  // page; reply 0 (the very first) is the one page one leaves behind.
  // exact: true — "respuesta número 2" would otherwise substring-match
  // "respuesta número 20" (getByText/getByRole default to substring
  // matching; other specs in this suite hit the same class of bug with
  // "Postear"/"Repostear" and "Postear" inside the dialog's own submit).
  await expect(page.getByText('respuesta número 20', { exact: true })).toBeVisible()
  await expect(page.getByText('respuesta número 0', { exact: true })).not.toBeVisible()

  await loadMoreButton.click()

  await expect(page.getByText('respuesta número 0', { exact: true })).toBeVisible()
  await expect(loadMoreButton).not.toBeVisible()
})
