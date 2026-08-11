import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      // Repository queries and the BullMQ wiring itself touch real
      // Postgres/Redis — exercised by test:integration, not unit tests.
      include: [
        'src/fanout/fanout.processor.ts',
        'src/counters/counters.flush-worker.ts',
        'src/env.ts',
      ],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
