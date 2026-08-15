import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    // Two real Testcontainers (Postgres + PgBouncer) plus a migration run
    // comfortably exceeds vitest's 5s default — same reasoning as apps/api's
    // and apps/workers' own vitest.integration.config.ts.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/client.ts'],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
