import { type Locator, expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

test('switches the interface language from Settings, persists it across a reload, and updates <html lang> (ROADMAP.md 2.10)', async ({
  page,
}) => {
  await signUpAndLogIn(page, 'i18n')
  await page.goto('/settings')

  // Default locale (no cookie set yet) is Spanish — SPECS.md's own UI copy
  // has always been Spanish-first, and i18n/config.ts's DEFAULT_LOCALE
  // matches that instead of the more common "en" convention.
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible()

  await page.getByLabel('Idioma de la interfaz').selectOption('en')

  // router.refresh() re-fetches every Server Component against the new
  // cookie — no full navigation, but the same real text swap a navigation
  // would produce.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  // The ICU plural in SessionsList.count resolves through the same swap —
  // proves this isn't just a handful of hardcoded strings toggling, but the
  // catalog's own interpolation machinery running in English.
  await expect(page.getByText(/^\d+ active sessions?$/)).toBeVisible()

  // The cookie (not just in-memory React state) is what persisted — a real
  // reload re-resolves the locale server-side from scratch.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
})

test('a logical CSS property (text-start) resolves to the direction-independent "start" keyword, and visually mirrors the text under a forced RTL direction (ROADMAP.md 2.10)', async ({
  page,
}) => {
  // Neither launch locale (es/en) is RTL — i18n/config.ts's own LOCALE_DIRECTION
  // table documents that a real RTL locale is future work. What this test
  // verifies instead is the *mechanism* the roadmap bullet actually asks
  // for: components already migrated to logical properties (`text-start`,
  // not `text-left`) resolve to CSS's own direction-independent `start`
  // keyword (never a hardcoded physical side), and genuinely re-align
  // visually once `dir` does — forcing it here is the only way to exercise
  // that today, since no shipped locale sets it for us.
  await signUpAndLogIn(page, 'rtl')
  await page.goto('/settings')

  const header = page.getByRole('columnheader', { name: 'Tipo', exact: true })
  await expect(header).toBeVisible()
  // 'start', not 'left'/'right' — the computed value the CSS Values spec
  // itself keeps direction-independent; a browser only resolves it to a
  // physical side at layout/paint time, based on `dir`, which is exactly
  // what makes this RTL-safe without any conditional styling of our own.
  await expect(header).toHaveCSS('text-align', 'start')

  const [cellBoxLtr, textBoxLtr] = await measureHeaderTextOffset(header)
  // Comfortably left-aligned in LTR: the text starts within a few pixels of
  // the cell's own left edge, not centered or right-hugging.
  expect(textBoxLtr.x - cellBoxLtr.x).toBeLessThan(8)

  await page.evaluate(() => {
    document.documentElement.dir = 'rtl'
  })
  const [cellBoxRtl, textBoxRtl] = await measureHeaderTextOffset(header)
  // Same logical `text-align: start`, but now flush against the cell's
  // *right* edge instead — the visible mirroring a physical `text-align:
  // left` could never produce under a `dir` flip.
  const cellRightEdge = cellBoxRtl.x + cellBoxRtl.width
  const textRightEdge = textBoxRtl.x + textBoxRtl.width
  expect(cellRightEdge - textRightEdge).toBeLessThan(8)
})

async function measureHeaderTextOffset(
  header: Locator,
): Promise<[{ x: number; width: number }, { x: number; width: number }]> {
  const cellBox = await header.boundingBox()
  const textBox = await header.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const rect = range.getBoundingClientRect()
    return { x: rect.x, width: rect.width }
  })
  if (!cellBox) throw new Error('expected the header cell to have a bounding box')
  return [cellBox, textBox]
}
