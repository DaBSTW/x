import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      // Pure logic only — the actual WS handshake, ticket redemption and
      // Redis pub/sub fan-out touch real Redis/Postgres and are exercised by
      // test:integration instead (CODESTYLE.md §14: no infra mocks).
      include: [
        'src/gateway/channel-authorization.ts',
        'src/gateway/connection-registry.ts',
        'src/gateway/subscription-handler.ts',
        'src/env.ts',
      ],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
