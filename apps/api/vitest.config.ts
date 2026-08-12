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
      // Routes, repositories, plugins, rate-limit and mailer.tsx itself
      // touch real Postgres/Redis/SMTP — exercised by the integration suite
      // (test:integration), not unit tests. The email templates it renders
      // (ROADMAP.md 2.9) are pure presentational JSX with neither, same
      // "pure logic" bucket as the *.service.ts files below — listed
      // individually, not a src/emails/*.tsx glob, so it can't also sweep
      // in their own *.test.tsx files sitting right next to them.
      include: [
        'src/modules/**/*.service.ts',
        'src/env.ts',
        'src/emails/layout.tsx',
        'src/emails/verification-email.tsx',
        'src/emails/password-reset-email.tsx',
        'src/emails/security-alert-email.tsx',
      ],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
