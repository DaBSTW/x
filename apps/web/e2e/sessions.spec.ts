import { expect, test } from '@playwright/test'
import { TEST_PASSWORD, logIn, signUp, uniqueUsername } from './helpers'

test('revokes another session from the sessions list, leaving the current one alone (ROADMAP.md 2.6)', async ({
  page,
}) => {
  const username = uniqueUsername('sess')
  await signUp(page, username)
  const email = `${username}@example.com`

  // A second, independent login for the same account — simulates a second
  // device. Done before the UI login below so that one (not this one) ends
  // up as the browser's actual session — Playwright's page.request shares
  // the page's cookie jar, and the later Set-Cookie wins.
  const secondLogin = await page.request.post('http://localhost:3001/v1/auth/login', {
    data: { email, password: TEST_PASSWORD },
  })
  expect(secondLogin.ok()).toBe(true)

  await logIn(page, username)
  await page.goto('/settings')

  const sessionRows = page.getByRole('list', { name: 'Sesiones activas' }).getByRole('listitem')
  await expect(sessionRows).toHaveCount(2)
  await expect(page.getByText('Esta sesión')).toBeVisible()

  await page.getByRole('button', { name: 'Cerrar sesión' }).click()

  await expect(sessionRows).toHaveCount(1)
  await expect(page.getByText('Esta sesión')).toBeVisible()
})
