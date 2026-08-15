import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      // Same posture as apps/web's own vitest.config.ts (its comment is the
      // fuller version of this one): data-fetching hooks and the components
      // that wire them together are exercised for real by
      // e2e/moderation.spec.ts, against a real apps/api and Postgres, not
      // mocked here. Pure logic — no network — is unit-tested and counted.
      include: ['lib/cn.ts', 'lib/format.ts'],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
