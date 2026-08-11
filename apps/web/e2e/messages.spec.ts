import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('starting a DM by username delivers messages both ways (ROADMAP.md 2.5)', async ({
  browser,
}) => {
  const aliceContext = await browser.newContext()
  const bobContext = await browser.newContext()
  const alicePage = await aliceContext.newPage()
  const bobPage = await bobContext.newPage()

  const aliceUsername = await signUpAndLogIn(alicePage, 'dmalice')
  const bobUsername = await signUpAndLogIn(bobPage, 'dmbob')

  await alicePage.goto('/messages')
  await alicePage.getByLabel('Usuario con quien empezar a chatear').fill(bobUsername)
  await alicePage.getByRole('button', { name: 'Nuevo mensaje' }).click()
  await alicePage.waitForURL(/\/messages\/\d+/)

  const outgoing = `hola bob ${Date.now()}`
  await alicePage.getByLabel('Escribe un mensaje').fill(outgoing)
  await alicePage.getByRole('button', { name: 'Enviar' }).click()
  await expect(alicePage.getByText(outgoing)).toBeVisible()

  await bobPage.goto('/messages')
  await expect(bobPage.getByText(aliceUsername, { exact: false })).toBeVisible({
    timeout: 15_000,
  })
  await bobPage.getByRole('link', { name: new RegExp(aliceUsername, 'i') }).click()
  await expect(bobPage.getByText(outgoing)).toBeVisible()

  const reply = `hola alice ${Date.now()}`
  await bobPage.getByLabel('Escribe un mensaje').fill(reply)
  await bobPage.getByRole('button', { name: 'Enviar' }).click()
  await expect(bobPage.getByText(reply)).toBeVisible()

  // use-messages.ts polls every 5s (no WS gateway yet, ROADMAP.md 2.2).
  await expect(alicePage.getByText(reply)).toBeVisible({ timeout: 15_000 })

  await aliceContext.close()
  await bobContext.close()
})
