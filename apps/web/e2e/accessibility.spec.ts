import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signUpAndLogIn } from './helpers'

// CODESTYLE.md / SPECS.md §7.5: "cualquier violación WCAG 2.2 AA bloquea el
// merge" (ROADMAP.md 2.10) — these four tag sets are axe-core's own
// documented way to ask for the full 2.2 AA bar, since 2.2 AA subsumes
// every earlier 2.x A/AA success criterion rather than replacing them.
const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test.describe('accessibility (ROADMAP.md 2.10)', () => {
  test('the public login and signup pages have no WCAG 2.2 AA violations', async ({ page }) => {
    for (const path of ['/login', '/signup']) {
      await page.goto(path)
      const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA_TAGS).analyze()
      expect(results.violations, describeViolations(path, results.violations)).toEqual([])
    }
  })

  test('the authenticated app has no WCAG 2.2 AA violations across its main pages', async ({
    page,
  }) => {
    // 8 pages × (a cold Next.js dev-mode compile on first visit + a full
    // axe-core scan) outgrew the default 30s as (app)/layout.tsx picked up
    // another globally-mounted client component (<QuoteComposerDialog>,
    // ROADMAP.md 2.1 "Citas", alongside <KeyboardShortcutsDialog>) — every
    // route under that layout now bundles it. Purely a timing budget, not a
    // retry for flakiness: each page still gets exactly one real scan below.
    test.setTimeout(60_000)
    const username = await signUpAndLogIn(page, 'a11y')

    const paths = [
      '/home',
      '/notifications',
      '/bookmarks',
      '/lists',
      '/follow-requests',
      '/messages',
      '/settings',
      `/${username}`,
    ]
    for (const path of paths) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA_TAGS).analyze()
      expect(results.violations, describeViolations(path, results.violations)).toEqual([])
    }
  })
})

function describeViolations(
  path: string,
  violations: Array<{ id: string; help: string; nodes: Array<{ target: unknown }> }>,
): string {
  if (violations.length === 0) return ''
  const lines = violations.map(
    (violation) => `  - ${violation.id}: ${violation.help} (${violation.nodes.length} element(s))`,
  )
  return `${path} has ${violations.length} WCAG violation(s):\n${lines.join('\n')}`
}
