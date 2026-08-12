import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

// A real, valid 2×2 PNG (generated with sharp and round-tripped back
// through it to confirm) — small enough to upload and process (real
// S3/MinIO PUT, real apps/workers sharp transcode) in well under a second,
// but genuine decodable image bytes: magic-byte sniffing accepts a
// well-formed *header* alone (ROADMAP.md 1.5), but the worker's own
// transcode step needs bytes libspng can actually decode all the way
// through, which a hand-typed placeholder isn't guaranteed to be.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGMwTjtjnHaGAUIBACS2BZU4w3+7AAAAAElFTkSuQmCC'

test('adds alt text to an attached image from the composer, and it renders on the published post (ROADMAP.md 1.8)', async ({
  page,
}) => {
  await signUpAndLogIn(page, 'alttext')

  await page.locator('input[type="file"]').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  })

  // The ALT button appears as soon as upload-url assigns a mediaId — well
  // before the worker finishes transcoding, since PATCH /media/:id itself
  // only ever checks ownership (media.service.ts's updateAltText).
  const altButton = page.getByRole('button', { name: 'Añadir texto alternativo' })
  await expect(altButton).toBeVisible({ timeout: 15_000 })
  await altButton.click()

  await expect(page.getByRole('dialog', { name: 'Texto alternativo' })).toBeVisible()
  const altText = `una imagen de prueba ${Date.now()}`
  // getByLabel would also match the "Añadir/Editar texto alternativo" ALT
  // button and the dialog itself — both share "texto alternativo" as a
  // substring of their own accessible name. role='textbox' narrows to just
  // the field (the same class of collision this suite has hit before with
  // plain text/label matches — always add exact or a role, never assume
  // uniqueness).
  await page.getByRole('textbox', { name: 'Texto alternativo', exact: true }).fill(altText)
  await page.getByRole('button', { name: 'Guardar' }).click()

  // Saved — the dialog closes and the button switches to "editar" phrasing.
  await expect(page.getByRole('dialog', { name: 'Texto alternativo' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Editar texto alternativo' })).toBeVisible()

  const postText = `post con alt text ${Date.now()}`
  await page.getByPlaceholder('¿Qué está pasando?').fill(postText)
  // Disabled until the attachment finishes processing (composer.tsx's
  // isBusy) — real apps/workers sharp transcode, not simulated.
  const postButton = page.getByRole('button', { name: 'Postear', exact: true })
  await expect(postButton).toBeEnabled({ timeout: 30_000 })
  await postButton.click()

  await expect(page.getByText(postText)).toBeVisible()
  // The full round trip: composer → PATCH /media/:id → POST /posts →
  // <MediaGrid> rendering the same altText back out as the <img>'s alt.
  await expect(page.getByAltText(altText)).toBeVisible()
})
