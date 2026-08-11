import type { Page } from '@playwright/test'

let counter = 0

/** A username within usernameSchema's 15-char, letters/digits/underscore limit, unique across a single test run. */
export function uniqueUsername(prefix: string): string {
  counter += 1
  const suffix = `${Date.now().toString(36)}${counter}`
  return `${prefix}${suffix}`.slice(0, 15)
}

export const TEST_PASSWORD = 'a genuinely unique passphrase 9x2'

export async function signUp(page: Page, username: string): Promise<void> {
  await page.goto('/signup')
  await page.getByLabel('Usuario').fill(username)
  await page.getByLabel('Email').fill(`${username}@example.com`)
  await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
  await page.getByLabel('Fecha de nacimiento').fill('1990-01-01')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await page.waitForURL('/login')
}

export async function logIn(page: Page, username: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(`${username}@example.com`)
  await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL('/home')
}

/** Login doesn't require a verified email (auth.service.ts's login() never checks it) — sign up then log straight in, no inbox to read. */
export async function signUpAndLogIn(page: Page, prefix: string): Promise<string> {
  const username = uniqueUsername(prefix)
  await signUp(page, username)
  await logIn(page, username)
  return username
}
