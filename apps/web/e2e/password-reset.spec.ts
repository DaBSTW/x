import { expect, test } from '@playwright/test'
import { TEST_PASSWORD, signUp, signUpAndLogIn, uniqueUsername, waitForEmailToken } from './helpers'

test('resets a forgotten password via the emailed link and logs in with it', async ({ page }) => {
  const username = uniqueUsername('reset')
  await signUp(page, username)
  const email = `${username}@example.com`

  await page.goto('/login')
  await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click()
  await expect(page).toHaveURL('/forgot-password')

  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Enviar enlace' }).click()
  await expect(page.getByText('Revisa tu email')).toBeVisible()

  const token = await waitForEmailToken('Restablece tu contraseña', email)
  const newPassword = 'a brand new post-reset passphrase 7z1'

  await page.goto(`/reset-password?token=${token}`)
  await page.getByLabel('Contraseña nueva').fill(newPassword)
  await page.getByRole('button', { name: 'Guardar contraseña' }).click()
  await expect(page).toHaveURL('/login')

  // The old password stopped working...
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('invalid email or password')).toBeVisible()

  // ...but the new one signs in.
  await page.getByLabel('Contraseña').fill(newPassword)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL('/home')
})

test('changes a password from settings, rejecting the wrong current password first', async ({
  page,
}) => {
  await signUpAndLogIn(page, 'chpw')

  await page.goto('/settings')
  await page.getByLabel('Contraseña actual').fill('definitely the wrong passphrase')
  await page.getByLabel('Contraseña nueva').fill('another brand new passphrase 3q9')
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click()
  await expect(page.getByText('current password is incorrect')).toBeVisible()

  await page.getByLabel('Contraseña actual').fill(TEST_PASSWORD)
  await page.getByLabel('Contraseña nueva').fill('another brand new passphrase 3q9')
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click()
  await expect(
    page.getByText('Contraseña actualizada. Se cerró la sesión en tus otros dispositivos.'),
  ).toBeVisible()
})

// Also exercised by the login link above, but login.spec.ts style: a
// standalone check that the page always answers the same way (SPECS.md
// §11.3), whether or not the email actually belongs to an account.
test('forgot-password shows the same confirmation for an unregistered email', async ({ page }) => {
  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(`${uniqueUsername('ghost')}@example.com`)
  await page.getByRole('button', { name: 'Enviar enlace' }).click()
  await expect(page.getByText('Revisa tu email')).toBeVisible()
})
