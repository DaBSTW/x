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

type MailpitMessagesResponse = {
  messages: Array<{ ID: string; To: Array<{ Address: string }>; Subject: string }>
}
type MailpitMessageResponse = { HTML: string; Text: string }

/**
 * Extracts a `token=` link parameter from the first real email (Mailpit,
 * global-setup.ts) matching both a subject substring and recipient — the
 * same disambiguation apps/api's auth.integration.test.ts relies on, since
 * one inbox can hold more than one email (verification, security alerts,
 * a reset link) by the time a test reads it.
 */
export async function waitForEmailToken(
  subjectContains: string,
  toAddress: string,
): Promise<string> {
  const mailpitApiUrl = process.env.MAILPIT_API_URL
  if (!mailpitApiUrl) throw new Error('MAILPIT_API_URL is not set — is global-setup.ts running?')

  for (let attempt = 0; attempt < 40; attempt++) {
    const listResponse = await fetch(`${mailpitApiUrl}/api/v1/messages`)
    const list = (await listResponse.json()) as MailpitMessagesResponse
    const message = list.messages.find(
      (candidate) =>
        candidate.Subject.includes(subjectContains) &&
        candidate.To.some((recipient) => recipient.Address === toAddress),
    )

    if (message) {
      const detailResponse = await fetch(`${mailpitApiUrl}/api/v1/message/${message.ID}`)
      const detail = (await detailResponse.json()) as MailpitMessageResponse
      const match = /token=([^"&\s]+)/.exec(detail.HTML || detail.Text)
      if (match?.[1]) return decodeURIComponent(match[1])
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`timed out waiting for an email with subject containing "${subjectContains}"`)
}
