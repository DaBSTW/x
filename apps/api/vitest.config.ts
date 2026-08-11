import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Same reason as packages/utils/vitest.config.ts: auth.service.test.ts
    // hashes real passwords with Argon2 (deliberately slow/memory-hard),
    // which can cross the 5s default under this monorepo's full parallel
    // build/test contention even though it's fast standalone.
    testTimeout: 15_000,
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      // Routes, repositories, plugins, rate-limit and mailer touch real
      // Postgres/Redis/SMTP — exercised by the integration suite
      // (test:integration), not unit tests.
      include: ['src/modules/**/*.service.ts', 'src/env.ts'],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
