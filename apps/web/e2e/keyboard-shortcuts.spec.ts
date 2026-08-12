import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('j/k/l/t navigate the timeline and act on the focused post, ? shows help, n focuses the composer (ROADMAP.md 2.10)', async ({
  page,
}) => {
  await signUpAndLogIn(page, 'kbd')

  const textA = `post A ${Date.now()}`
  const textB = `post B ${Date.now()}`
  await page.getByPlaceholder('¿Qué está pasando?').fill(textA)
  await page.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(page.getByText(textA)).toBeVisible()
  await page.getByPlaceholder('¿Qué está pasando?').fill(textB)
  await page.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(page.getByText(textB)).toBeVisible()

  // Move focus off the composer so the shortcut listener isn't shadowed by
  // "typing into a text field" (use-post-feed-keyboard-nav.ts ignores keys
  // while an input/textarea holds focus, on purpose).
  await page.locator('body').click({ position: { x: 5, y: 5 } })

  // j lands on the newest post first — use-create-post.ts prepends it to index 0.
  await page.keyboard.press('j')
  const focused = page.locator(':focus')
  await expect(focused).toContainText(textB)

  // l likes the focused post.
  await page.keyboard.press('l')
  await expect(focused.getByRole('button', { name: 'Quitar me gusta' })).toBeVisible()

  // j again moves to the next (older) post — clicking the like button above
  // shifted real DOM focus onto it, so this also proves j re-derives the
  // post index from that button's ancestor rather than losing it.
  await page.keyboard.press('j')
  await expect(page.locator(':focus')).toContainText(textA)

  // k moves back to the newer post.
  await page.keyboard.press('k')
  await expect(page.locator(':focus')).toContainText(textB)

  // t reposts the focused post.
  await page.keyboard.press('t')
  await expect(focused.getByRole('button', { name: 'Deshacer repost' })).toBeVisible()

  // ? opens the shortcuts help dialog; Escape (Radix's own handling) closes it.
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Atajos de teclado')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // n focuses the composer.
  await page.keyboard.press('n')
  await expect(page.getByPlaceholder('¿Qué está pasando?')).toBeFocused()
})

test('r navigates to the focused post’s thread, same as clicking "Responder" (ROADMAP.md 2.10)', async ({
  page,
}) => {
  const username = await signUpAndLogIn(page, 'kbdr')
  const text = `post to reply to ${Date.now()}`
  await page.getByPlaceholder('¿Qué está pasando?').fill(text)
  await page.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(page.getByText(text)).toBeVisible()

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('j')
  await expect(page.locator(':focus')).toContainText(text)

  await page.keyboard.press('r')
  await page.waitForURL(new RegExp(`/${username}/status/`))
})
