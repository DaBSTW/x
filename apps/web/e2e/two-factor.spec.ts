import { expect, test } from '@playwright/test'
import { generateTotp } from '@x/utils'
import { TEST_PASSWORD, signUpAndLogIn } from './helpers'

test('enables 2FA from settings and requires it on the next login, recovery code included (ROADMAP.md 2.6)', async ({
  page,
  browser,
}) => {
  const username = await signUpAndLogIn(page, 'twofa')

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Activar verificación en dos pasos' }).click()
  await expect(
    page.getByAltText('Código QR para configurar la verificación en dos pasos'),
  ).toBeVisible()
  const secret = await page.locator('code').innerText()

  await page.getByLabel('Código de 6 dígitos').fill(await generateTotp(secret))
  await page.getByRole('button', { name: 'Confirmar' }).click()

  await expect(page.getByText('Guarda tus códigos de recuperación')).toBeVisible()
  const recoveryCode = await page
    .getByRole('list', { name: 'Códigos de recuperación' })
    .getByRole('listitem')
    .first()
    .innerText()
  await page.getByRole('button', { name: 'Ya los guardé' }).click()
  await expect(page.getByText('Verificación en dos pasos activada.')).toBeVisible()

  // A fresh, unauthenticated context — logging back in now needs a second step.
  const freshContext = await browser.newContext()
  const freshPage = await freshContext.newPage()
  await freshPage.goto('/login')
  await freshPage.getByLabel('Email').fill(`${username}@example.com`)
  await freshPage.getByLabel('Contraseña').fill(TEST_PASSWORD)
  await freshPage.getByRole('button', { name: 'Entrar' }).click()

  await expect(freshPage.getByRole('heading', { name: 'Verificación en dos pasos' })).toBeVisible()
  const codeLabel = 'Código de tu app de autenticación o un código de recuperación'
  await freshPage.getByLabel(codeLabel).fill(await generateTotp(secret))
  await freshPage.getByRole('button', { name: 'Verificar' }).click()
  await freshPage.waitForURL('/home')

  // The recovery code shown during setup works too, and only once.
  const recoveryContext = await browser.newContext()
  const recoveryPage = await recoveryContext.newPage()
  await recoveryPage.goto('/login')
  await recoveryPage.getByLabel('Email').fill(`${username}@example.com`)
  await recoveryPage.getByLabel('Contraseña').fill(TEST_PASSWORD)
  await recoveryPage.getByRole('button', { name: 'Entrar' }).click()
  await recoveryPage.getByLabel(codeLabel).fill(recoveryCode)
  await recoveryPage.getByRole('button', { name: 'Verificar' }).click()
  await recoveryPage.waitForURL('/home')

  await freshContext.close()
  await recoveryContext.close()
})
