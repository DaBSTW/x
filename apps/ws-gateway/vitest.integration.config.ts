import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    // Container startup (Postgres + Redis) plus real WebSocket round trips
    // comfortably exceeds vitest's 5s default.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 60, statements: 60, branches: 60, functions: 60 },
    },
  },
})
