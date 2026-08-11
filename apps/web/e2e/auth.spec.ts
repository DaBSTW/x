import { expect, test } from '@playwright/test'
import { logIn, signUp, uniqueUsername } from './helpers'

test('a new user can sign up and log in to their home timeline', async ({ page }) => {
  const username = uniqueUsername('reg')

  await signUp(page, username)
  await expect(page).toHaveURL('/login')

  // Login never checks emailVerified (auth.service.ts) — no inbox to read.
  await logIn(page, username)
  await expect(page).toHaveURL('/home')
  await expect(page.getByPlaceholder('¿Qué está pasando?')).toBeVisible()
})

test('rejects a login with the wrong password', async ({ page }) => {
  const username = uniqueUsername('badpw')
  await signUp(page, username)

  await page.goto('/login')
  await page.getByLabel('Email').fill(`${username}@example.com`)
  await page.getByLabel('Contraseña').fill('definitely the wrong passphrase')
  await page.getByRole('button', { name: 'Entrar' }).click()

  // auth.service.ts's UnauthenticatedError message reaches the toast as-is
  // (use-auth-mutations.ts rethrows error.error.message directly).
  await expect(page.getByText('invalid email or password')).toBeVisible()
  await expect(page).toHaveURL('/login')
})
