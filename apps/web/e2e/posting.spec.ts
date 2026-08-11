import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('a logged-in user can publish a post and see it in their own timeline', async ({ page }) => {
  await signUpAndLogIn(page, 'post')
  const text = `hola desde e2e ${Date.now()}`

  await page.getByPlaceholder('¿Qué está pasando?').fill(text)
  await page.getByRole('button', { name: 'Postear' }).click()

  // use-create-post.ts prepends the real created post to the cached
  // timeline on success — no reload, no polling needed.
  await expect(page.getByText(text)).toBeVisible()
})
