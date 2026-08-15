import { expect, test } from '@playwright/test'
import { createPost, makeModerator, registerAndLogin, reportPost } from './helpers.js'

async function logInAsAdmin(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill('a genuinely unique passphrase 9x2')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL('/queue')
}

test('a moderator reviews a real report, acts on it, and finds it again in history and account search (ROADMAP.md 3.3g)', async ({
  page,
}) => {
  const author = await registerAndLogin('adm_author')
  const reporter = await registerAndLogin('adm_reporter')
  const moderator = await registerAndLogin('adm_mod')
  await makeModerator(moderator.id)

  const postId = await createPost(author.accessToken, 'contenido reportable para el panel')
  await reportPost(reporter.accessToken, postId, 'harassment', 'acoso de verdad')

  // 1. Cola de revisión — the real report shows up.
  await logInAsAdmin(page, moderator.email)
  await expect(page.getByRole('heading', { name: 'Cola de revisión' })).toBeVisible()
  const queueItem = page.getByRole('listitem').filter({ hasText: postId })
  await expect(queueItem).toBeVisible()
  await expect(queueItem).toContainText('Acoso')

  // Act on it: hide the post.
  await queueItem.getByRole('button', { name: 'Actuar' }).click()
  await queueItem.getByLabel('Acción').selectOption('hide')
  await queueItem.getByLabel('Política aplicada').fill('harassment')
  await queueItem.getByLabel('Motivo').fill('acoso confirmado por el panel')
  await queueItem.getByRole('button', { name: 'Aplicar acción' }).click()

  // The report leaves the pending queue once resolved.
  await expect(page.getByText('No hay reportes pendientes.')).toBeVisible()

  // 2. Historial de acciones — the action just taken shows up.
  await page.getByRole('link', { name: 'Historial de acciones' }).click()
  await expect(page.getByRole('heading', { name: 'Historial de acciones' })).toBeVisible()
  const historyRow = page.getByRole('row').filter({ hasText: postId })
  await expect(historyRow).toBeVisible()
  await expect(historyRow).toContainText('Ocultación')
  await expect(historyRow).toContainText(`moderador #${moderator.id}`)

  // 3. Búsqueda de cuentas — the author's trust score, and a fresh action
  // taken straight from this page (distinct from the "hide *the post*"
  // action above: this account's own history only lists actions with
  // targetType 'user', moderation_actions' own schema comment on why —
  // the post-hide already asserted above lives under that post's own
  // target, checked via /history above instead, not here).
  await page.getByRole('link', { name: 'Búsqueda de cuentas' }).click()
  await page.getByLabel('Nombre de usuario').fill(author.username)
  await page.getByRole('button', { name: 'Buscar' }).click()
  await expect(page.getByText(`@${author.username}`)).toBeVisible()
  await expect(page.getByText(/Score de confianza:/)).toBeVisible()
  await expect(page.getByText('Sin acciones previas.')).toBeVisible()

  // 'read_only' (not 'label'/'hide'/etc.) — apply-action-form.tsx only
  // offers the user-target actions here (moderation.service.ts's own
  // POST_ACTIONS/USER_ACTIONS split), so this also covers the conditional
  // "duración" field only 'read_only' shows.
  await page.getByLabel('Acción').selectOption('read_only')
  await page.getByLabel(/Duración/).fill('24')
  await page.getByLabel('Política aplicada').fill('spam')
  await page.getByLabel('Motivo').fill('cuenta puesta en modo lectura desde búsqueda de cuentas')
  await page.getByRole('button', { name: 'Aplicar acción' }).click()

  await expect(
    page.getByText(/Modo lectura — cuenta puesta en modo lectura desde búsqueda de cuentas/),
  ).toBeVisible()
})

test('a logged-in non-moderator sees an access-denied message, not a broken page', async ({
  page,
}) => {
  const plainUser = await registerAndLogin('adm_plain')

  await logInAsAdmin(page, plainUser.email)
  await expect(page.getByText(/no tenga acceso de moderador/)).toBeVisible()
})
