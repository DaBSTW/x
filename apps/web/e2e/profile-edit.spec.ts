import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

// Same fixture as media-alt-text.spec.ts — a real, decodable 2×2 PNG
// (generated with sharp and round-tripped back through it), not a
// hand-typed placeholder that passes magic-byte sniffing but fails the
// worker's actual transcode.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGMwTjtjnHaGAUIBACS2BZU4w3+7AAAAAElFTkSuQmCC'

test('edits display name, bio, location, website, and avatar from the own-profile dialog (ROADMAP.md 1.6)', async ({
  page,
}) => {
  const username = await signUpAndLogIn(page, 'editprofile')
  await page.goto(`/${username}`)

  // Own profile: "Editar perfil", never the follow button — profile-header.tsx's isOwnProfile branch.
  await expect(page.getByRole('button', { name: 'Seguir' })).not.toBeVisible()
  await page.getByRole('button', { name: 'Editar perfil' }).click()

  const dialog = page.getByRole('dialog', { name: 'Editar perfil' })
  await expect(dialog).toBeVisible()
  // Re-seeded from the current profile on open (the same remount-by-key
  // pattern as composer.tsx's AltTextDialog) — starts as the signup default.
  await expect(dialog.getByLabel('Nombre', { exact: true })).toHaveValue(username)

  const newName = `Perfil editado ${Date.now()}`
  const bio = 'Biografía de prueba con acentos: áéíóú'
  const location = 'Ciudad de México'
  const website = 'https://example.com/perfil'

  await dialog.getByLabel('Nombre', { exact: true }).fill(newName)
  await dialog.getByLabel('Biografía', { exact: true }).fill(bio)
  await dialog.getByLabel('Ubicación', { exact: true }).fill(location)
  await dialog.getByLabel('Sitio web', { exact: true }).fill(website)

  await dialog.getByLabel('Foto de perfil', { exact: true }).setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  })
  // Uploads immediately on selection (composer's own pattern), not deferred to Guardar.
  await expect(dialog.getByRole('button', { name: 'Subiendo…' })).toHaveCount(0, {
    timeout: 15_000,
  })

  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog).not.toBeVisible()

  // profile-header.tsx renders displayName as plain text, not a heading
  // element — getByText, not getByRole('heading'). exact: true to skip
  // Next.js's own route-announcer live region, which echoes the page
  // <title> ("Perfil editado… (@user) — X") and would otherwise
  // substring-match this same query too.
  await expect(page.getByText(newName, { exact: true })).toBeVisible()
  await expect(page.getByText(bio)).toBeVisible()
  await expect(page.getByText(location)).toBeVisible()
  const websiteLink = page.getByRole('link', { name: website })
  await expect(websiteLink).toBeVisible()
  await expect(websiteLink).toHaveAttribute('href', website)
  // AvatarImage (Radix) only ever renders an <img> once the src has
  // actually loaded — a fresh signup has no avatar, so this element simply
  // doesn't exist until the upload+save above actually worked.
  await expect(page.locator('img[src*="x-media"]').first()).toBeVisible()

  // Persists past a reload, not just optimistic client state.
  await page.reload()
  await expect(page.getByText(newName, { exact: true })).toBeVisible()
  await expect(page.locator('img[src*="x-media"]').first()).toBeVisible()
})
