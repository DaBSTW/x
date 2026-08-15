import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // generate.test.ts creates a few thousand users/posts/follows in
    // memory — comfortably under 5s standalone, but this monorepo's full
    // `turbo run typecheck test build` runs every package's build and test
    // suite in parallel, and enough concurrent CPU-bound work elsewhere
    // (sharp/AVIF encoding, argon2 hashing, tsc, webpack) can push even
    // legitimate work past the default budget — same reasoning as
    // packages/utils' and apps/api's own vitest.config.ts.
    testTimeout: 15_000,
    exclude: ['**/node_modules/**', '**/migrations/**', '**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      // client.ts, migrate.ts and seed/run.ts are thin I/O wiring against a
      // real Postgres — covered by integration tests (ROADMAP.md 3.4c's own
      // client.pgbouncer.integration.test.ts, run separately via
      // test:integration — the same split every other package with a real
      // Testcontainers suite already uses), not unit tests.
      include: ['src/seed/generate.ts'],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
