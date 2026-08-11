import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
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
