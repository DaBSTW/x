import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/migrations/**'],
    coverage: {
      provider: 'v8',
      // client.ts, migrate.ts and seed/run.ts are thin I/O wiring against a
      // real Postgres — covered by integration tests once Testcontainers
      // lands (ROADMAP.md 0.7), not unit tests.
      include: ['src/seed/generate.ts'],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
