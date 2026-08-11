import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// Some sandboxes pre-install Chromium outside Playwright's own managed
// cache to avoid a network download; CI and a plain developer machine
// don't have that path; and it should transparently fall back to
// Playwright's normal browser resolution — `playwright install chromium`.
const PINNED_CHROMIUM_PATH = '/opt/pw-browsers/chromium'

/**
 * e2e against a real stack (ROADMAP.md 1.8, SPECS.md §17.1): globalSetup
 * boots real Postgres/Redis/MinIO/Mailpit (Testcontainers, same as every
 * `*.integration.test.ts`) plus real apps/api, apps/workers, and apps/web
 * processes, all torn down together when the run ends. `workers: 1` — every
 * spec shares that one backend, so tests run sequentially rather than
 * risking two specs racing the same database.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // 'list' for real-time console output; 'html' writes playwright-report/,
  // which turbo.json declares as this task's cacheable output and CI
  // uploads as an artifact on failure — 'list' alone never writes it.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    ...(existsSync(PINNED_CHROMIUM_PATH) && {
      launchOptions: { executablePath: PINNED_CHROMIUM_PATH },
    }),
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
