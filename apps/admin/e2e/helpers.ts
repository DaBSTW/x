import { createDatabase, users } from '@x/db'
import { eq } from 'drizzle-orm'

const API_BASE_URL = 'http://localhost:3001/v1'

let counter = 0

/** A username within usernameSchema's 15-char, letters/digits/underscore limit, unique across a single test run — same as apps/web's own e2e/helpers.ts. */
export function uniqueUsername(prefix: string): string {
  counter += 1
  const suffix = `${Date.now().toString(36)}${counter}`
  return `${prefix}${suffix}`.slice(0, 15)
}

export const TEST_PASSWORD = 'a genuinely unique passphrase 9x2'

type RegisteredUser = { id: string; username: string; email: string; accessToken: string }

/**
 * Registers and logs in a plain user straight through apps/api's own
 * `/auth/*` endpoints — not through a UI, since this app (unlike apps/web)
 * has no sign-up page for the seed accounts a moderation scenario needs
 * (a poster, a reporter). Mirrors apps/api's own
 * moderation.integration.test.ts's registerAndLogin helper.
 */
export async function registerAndLogin(prefix: string): Promise<RegisteredUser> {
  const username = uniqueUsername(prefix)
  const email = `${username}@example.com`
  const registerResponse = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password: TEST_PASSWORD, birthDate: '1990-01-01' }),
  })
  if (!registerResponse.ok) {
    throw new Error(`register failed for ${username}: ${registerResponse.status}`)
  }
  const registerBody = (await registerResponse.json()) as { data: { id: string } }

  const loginResponse = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  })
  if (!loginResponse.ok) {
    throw new Error(`login failed for ${username}: ${loginResponse.status}`)
  }
  const loginBody = (await loginResponse.json()) as { data: { accessToken: string } }

  return { id: registerBody.data.id, username, email, accessToken: loginBody.data.accessToken }
}

/** isModerator (packages/db/src/schema/users.ts's own comment) has no API to set it — SQL only, same as apps/api's own moderation.integration.test.ts's makeModerator helper. Needs global-setup.ts's own process.env.DATABASE_URL. */
export async function makeModerator(userId: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set — is global-setup.ts running?')
  const db = createDatabase(databaseUrl)
  await db
    .update(users)
    .set({ isModerator: true })
    .where(eq(users.id, BigInt(userId)))
}

/** A real post via POST /posts — the target this suite's report/action flow points at. */
export async function createPost(accessToken: string, text: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ text }),
  })
  if (!response.ok) {
    throw new Error(`post creation failed: ${response.status}`)
  }
  const body = (await response.json()) as { data: { id: string } }
  return body.data.id
}

/** A real report via POST /reports — SPECS.md §12.1's reactive layer, the same one the admin panel's review queue reads from. */
export async function reportPost(
  accessToken: string,
  postId: string,
  category: string,
  reason: string,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ targetType: 'post', targetId: postId, category, reason }),
  })
  if (!response.ok) {
    throw new Error(`report failed: ${response.status}`)
  }
}
