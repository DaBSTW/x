import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('creates a list, opens it, and deletes it (ROADMAP.md 2.8)', async ({ page }) => {
  await signUpAndLogIn(page, 'list')
  const listName = `Lista ${Date.now()}`

  await page.goto('/lists')
  await page.getByRole('button', { name: 'Nueva lista' }).click()
  await page.getByLabel('Nombre').fill(listName)
  await page.getByRole('button', { name: 'Crear lista' }).click()

  const listLink = page.getByRole('link', { name: new RegExp(listName) })
  await expect(listLink).toBeVisible()

  await listLink.click()
  await expect(page.getByRole('heading', { name: listName })).toBeVisible()
  await expect(page.getByText('Nadie en esta lista ha publicado todavía.')).toBeVisible()

  await page.getByRole('button', { name: 'Eliminar' }).click()
  await expect(page).toHaveURL('/lists')
  await expect(page.getByText('Todavía no has creado ninguna lista.')).toBeVisible()
})
