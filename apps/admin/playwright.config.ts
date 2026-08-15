import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// Some sandboxes pre-install Chromium outside Playwright's own managed
// cache to avoid a network download; CI and a plain developer machine
// don't have that path — same fallback apps/web's own playwright.config.ts
// uses.
const PINNED_CHROMIUM_PATH = '/opt/pw-browsers/chromium'

/**
 * e2e against a real stack (ROADMAP.md 3.3g, SPECS.md §17.1's own
 * philosophy applied to this app): globalSetup boots real Postgres/Redis
 * (Testcontainers) plus a real apps/api and apps/admin process, torn down
 * together when the run ends. Leaner than apps/web's own global-setup.ts —
 * moderation lives entirely in apps/api (ROADMAP.md 3.3a–3.3f), so there's
 * no MinIO/apps/workers/ws-gateway dependency here; `notifyTarget`
 * (moderation.service.ts) already degrades an unreachable SMTP host to a
 * no-op (independent try/catch around the Kafka publish and the email
 * send), so this suite doesn't need Mailpit either — the email itself is
 * already covered for real by apps/api's own moderation.integration.test.ts.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3003',
    ...(existsSync(PINNED_CHROMIUM_PATH) && {
      launchOptions: { executablePath: PINNED_CHROMIUM_PATH },
    }),
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
