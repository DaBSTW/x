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
      // Data-fetching hooks (use-session, use-auth-mutations, api-client) and
      // components that only compose Radix primitives are exercised by
      // Playwright e2e once real pages exist (ROADMAP.md 0.6/1.8), not here.
      include: ['lib/cn.ts', 'lib/auth-store.ts', 'lib/theme-store.ts', 'components/ui/button.tsx'],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
