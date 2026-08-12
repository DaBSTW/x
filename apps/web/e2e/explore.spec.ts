import { expect, test } from '@playwright/test'
import { createDatabase, trendingTopics } from '@x/db'
import { GLOBAL_TREND_SCOPE, generateId } from '@x/utils'
import { signUpAndLogIn } from './helpers'

// apps/workers' compute-trends.ts (ROADMAP.md 2.4) is the only real writer
// of trending_topics, and it needs real hashtag activity from ≥50 distinct
// authors to produce anything (SPECS.md §10.4's antispam floor) — standing
// that up here would mean 50 real signups plus running the script, which
// would only re-prove what apps/workers' and apps/api's own integration
// tests against real ClickHouse/Postgres already cover directly. What
// those tests *can't* cover is whether the browser actually talks to the
// real running apps/api and renders what comes back — so this seeds the
// snapshot the same way apps/api's own trends.integration.test.ts does
// (global-setup.ts already exposes the real Testcontainers DATABASE_URL on
// process.env, same connection every other e2e helper and the app's own
// API process use) and drives the rest through a real browser.
test('shows trending hashtags and switches between global and language scopes', async ({
  page,
}) => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set by global-setup.ts')
  const db = createDatabase(process.env.DATABASE_URL)
  await db.insert(trendingTopics).values([
    {
      id: generateId(),
      scope: GLOBAL_TREND_SCOPE,
      hashtag: 'e2eglobaltag',
      score: 10,
      postCount1h: 200,
      uniqueAuthors1h: 80,
      computedAt: new Date(),
    },
    {
      id: generateId(),
      scope: 'es',
      hashtag: 'e2eespanoltag',
      score: 8,
      postCount1h: 150,
      uniqueAuthors1h: 70,
      computedAt: new Date(),
    },
  ])

  await signUpAndLogIn(page, 'explorer')
  await page.getByRole('link', { name: 'Explorar' }).click()
  await expect(page).toHaveURL('/explore')

  await expect(page.getByText('#e2eglobaltag')).toBeVisible()
  await expect(page.getByText('#e2eespanoltag')).not.toBeVisible()

  await page.getByRole('tab', { name: 'Español' }).click()
  await expect(page.getByText('#e2eespanoltag')).toBeVisible()
  await expect(page.getByText('#e2eglobaltag')).not.toBeVisible()
})
