import { expect, test } from '@playwright/test'
import { signUp, signUpAndLogIn, uniqueUsername } from './helpers'

test('creates a list, opens it, and deletes it (ROADMAP.md 2.8)', async ({ page }) => {
  await signUpAndLogIn(page, 'list')
  const listName = `Lista ${Date.now()}`

  await page.goto('/lists')
  await page.getByRole('button', { name: 'Nueva lista' }).click()
  await page.getByLabel('Nombre').fill(listName)
  await page.getByRole('button', { name: 'Crear lista' }).click()

  const listLink = page.getByRole('link', { name: new RegExp(listName) })
  await expect(listLink).toBeVisible()

  await listLink.click()
  // /lists/[id] is a dynamic route Next's dev server JIT-compiles on first
  // visit in a session — same settle-wait reasoning as thread-view.spec.ts's
  // own comment on /[username]/status/[id].
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: listName })).toBeVisible()
  await expect(page.getByText('Nadie en esta lista ha publicado todavía.')).toBeVisible()

  await page.getByRole('button', { name: 'Eliminar' }).click()
  await expect(page).toHaveURL('/lists')
  await expect(page.getByText('Todavía no has creado ninguna lista.')).toBeVisible()
})

test('adds and removes a list member by username (ROADMAP.md 2.8)', async ({ page }) => {
  const memberUsername = uniqueUsername('listmember')
  await signUp(page, memberUsername)

  await signUpAndLogIn(page, 'listowner')
  // listNameSchema caps names at 25 chars — short prefix, same margin
  // "creates a list..." above already leaves for its own timestamp suffix.
  const listName = `Miembros ${Date.now()}`

  await page.goto('/lists')
  await page.getByRole('button', { name: 'Nueva lista' }).click()
  await page.getByLabel('Nombre').fill(listName)
  await page.getByRole('button', { name: 'Crear lista' }).click()
  await page.getByRole('link', { name: new RegExp(listName) }).click()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: listName })).toBeVisible()

  // The member-count text doubles as the toggle for the roster below it.
  await page.getByRole('button', { name: '0 miembros', exact: true }).click()
  await expect(page.getByText('Esta lista todavía no tiene miembros.')).toBeVisible()

  await page.getByLabel('Usuario a añadir').fill(memberUsername)
  await page.getByRole('button', { name: 'Añadir', exact: true }).click()

  await expect(page.getByText(`@${memberUsername}`)).toBeVisible()
  await expect(page.getByRole('button', { name: '1 miembro', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Quitar', exact: true }).click()

  await expect(page.getByText('Esta lista todavía no tiene miembros.')).toBeVisible()
  await expect(page.getByRole('button', { name: '0 miembros', exact: true })).toBeVisible()
})

test('shows an error for a username that does not exist (ROADMAP.md 2.8)', async ({ page }) => {
  await signUpAndLogIn(page, 'listownerbad')
  const listName = `Lista ${Date.now()}`

  await page.goto('/lists')
  await page.getByRole('button', { name: 'Nueva lista' }).click()
  await page.getByLabel('Nombre').fill(listName)
  await page.getByRole('button', { name: 'Crear lista' }).click()
  await page.getByRole('link', { name: new RegExp(listName) }).click()
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: '0 miembros', exact: true }).click()
  // usernameSchema (and this input's own maxLength) cap usernames at 15
  // characters — this one is deliberately within that limit so it reaches
  // the mutation whole instead of getting silently truncated first.
  await page.getByLabel('Usuario a añadir').fill('noexiste404xx')
  await page.getByRole('button', { name: 'Añadir', exact: true }).click()

  await expect(page.getByText('no existe ninguna cuenta @noexiste404xx')).toBeVisible()
})
