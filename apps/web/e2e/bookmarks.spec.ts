import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('bookmarking a post surfaces it on the bookmarks page (ROADMAP.md 2.8)', async ({ page }) => {
  await signUpAndLogIn(page, 'bookmark')
  const text = `post para guardar ${Date.now()}`

  await page.getByPlaceholder('¿Qué está pasando?').fill(text)
  await page.getByRole('button', { name: 'Postear' }).click()
  await expect(page.getByText(text)).toBeVisible()

  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('button', { name: 'Quitar de guardados' })).toBeVisible()

  await page.getByRole('link', { name: 'Guardados' }).click()
  await expect(page).toHaveURL('/bookmarks')
  await expect(page.getByText(text)).toBeVisible()
})
