import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Argon2 (password.test.ts) is deliberately slow/memory-hard — that's
    // the whole point of a password hash. Comfortably under 5s standalone,
    // but this monorepo's full `turbo run typecheck test build` runs every
    // package's build and test suite in parallel, and enough concurrent
    // CPU-bound work (sharp/AVIF encoding, tsc, webpack, other packages'
    // own hashing) can push even legitimate work past the default budget.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      // Every source file except s3.ts, which is a thin pass-through over
      // the AWS SDK — its real behavior needs a live S3-compatible endpoint
      // to mean anything, which is exactly what apps/api's and apps/workers'
      // integration tests exercise it against (Testcontainers MinIO).
      // Unit-mocking the SDK here would violate CODESTYLE.md §14's "sin
      // mocks de infra real" for a false sense of coverage, so it's left
      // out rather than faked. An include allowlist (not `exclude`) so test
      // files and this config itself stay out of the denominator too,
      // matching apps/api's, apps/workers', and apps/web's vitest.config.ts.
      include: [
        'src/counters.ts',
        'src/errors.ts',
        'src/hibp.ts',
        'src/index.ts',
        'src/media.ts',
        'src/notifications.ts',
        'src/pagination.ts',
        'src/password.ts',
        'src/queues.ts',
        'src/realtime.ts',
        'src/snowflake/id.ts',
        'src/snowflake/snowflake.ts',
        'src/text/character-count.ts',
        'src/text/entities.ts',
        'src/text/index.ts',
        'src/timeline-constants.ts',
        'src/tokens.ts',
        'src/totp.ts',
      ],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
