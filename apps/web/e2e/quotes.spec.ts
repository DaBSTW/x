import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('a logged-in user can quote a post and see the embedded post in their timeline', async ({
  page,
}) => {
  await signUpAndLogIn(page, 'quote')
  const originalText = `post original para citar ${Date.now()}`
  const quoteText = `comentario sobre la cita ${Date.now()}`

  await page.getByPlaceholder('¿Qué está pasando?').fill(originalText)
  await page.getByRole('button', { name: 'Postear', exact: true }).click()
  await expect(page.getByText(originalText)).toBeVisible()

  // ROADMAP.md 2.1 "Citas" — opens <QuoteComposerDialog>, which previews the
  // quoted post via the same <QuotedPostCard> the timeline itself renders.
  await page.getByRole('button', { name: 'Citar', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(originalText)).toBeVisible()

  await dialog.getByPlaceholder('Añade un comentario').fill(quoteText)
  await dialog.getByRole('button', { name: 'Postear', exact: true }).click()

  // Dialog closes (onPosted calls close()) and the new quote lands at the
  // top of the timeline, embedding the original post's own text inside it —
  // not just coincidentally elsewhere on the page.
  await expect(dialog).not.toBeVisible()
  const quoteArticle = page.locator('article', { hasText: quoteText })
  await expect(quoteArticle.getByText(originalText)).toBeVisible()
})
