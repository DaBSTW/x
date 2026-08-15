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
      // client.ts, replicated-client.ts, migrate.ts and seed/run.ts are thin
      // I/O wiring against a real Postgres — covered by integration tests
      // (ROADMAP.md 3.4c's own client.pgbouncer.integration.test.ts and
      // 3.4d's own replicated-client.integration.test.ts, run separately
      // via test:integration — the same split every other package with a
      // real Testcontainers suite already uses), not unit tests.
      // read-write-context.ts is the exception among 3.4d's own new files:
      // pure logic (an AsyncLocalStorage wrapper, no I/O of its own), so it
      // belongs in this gate the same as generate.ts already is.
      include: ['src/seed/generate.ts', 'src/read-write-context.ts'],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
