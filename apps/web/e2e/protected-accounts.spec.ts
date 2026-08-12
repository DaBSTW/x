import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('requesting to follow a protected account gets approved and grants access to their posts (ROADMAP.md 2.6)', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext()
  const requesterContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  const requesterPage = await requesterContext.newPage()

  const ownerUsername = await signUpAndLogIn(ownerPage, 'protowner')
  const requesterUsername = await signUpAndLogIn(requesterPage, 'protreq')

  await ownerPage.goto('/settings')
  await ownerPage.getByLabel('Proteger mis posts').click()
  await expect(ownerPage.getByLabel('Proteger mis posts')).toBeChecked()

  await ownerPage.goto('/home')
  const postText = `un post protegido ${Date.now()}`
  await ownerPage.getByPlaceholder('¿Qué está pasando?').fill(postText)
  await ownerPage.getByRole('button', { name: 'Postear' }).click()
  await expect(ownerPage.getByText(postText)).toBeVisible()

  // Not an approved follower yet — the profile renders, the post doesn't.
  await requesterPage.goto(`/${ownerUsername}`)
  await requesterPage.waitForLoadState('networkidle')
  await expect(requesterPage.getByText('Todavía no hay posts.')).toBeVisible()
  await expect(requesterPage.getByText(postText)).not.toBeVisible()

  await requesterPage.getByRole('button', { name: 'Seguir' }).click()
  await expect(requesterPage.getByRole('button', { name: 'Solicitud enviada' })).toBeVisible()

  await ownerPage.goto('/follow-requests')
  await expect(ownerPage.getByText(`@${requesterUsername}`)).toBeVisible()
  await ownerPage.getByRole('button', { name: 'Aceptar' }).click()
  await expect(ownerPage.getByText('No tienes solicitudes pendientes.')).toBeVisible()

  // Now an approved follower — the post is visible. A fresh navigation has
  // no in-memory access token yet (auth-store.ts's token lives only in
  // memory) — without waiting for the silent refresh-cookie bootstrap
  // (providers.tsx's <SessionBootstrap>) to finish, the profile-posts query
  // could fire anonymously and see the protected post as hidden, same as
  // social.spec.ts's identical wait before its own first authenticated action.
  await requesterPage.goto(`/${ownerUsername}`)
  await requesterPage.waitForLoadState('networkidle')
  await expect(requesterPage.getByText(postText)).toBeVisible()

  await ownerContext.close()
  await requesterContext.close()
})
